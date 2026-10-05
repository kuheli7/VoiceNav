// Real extension in Chromium: the click fallback and the on-screen pointer. A page whose button ignores scripted clicks must
// still get pressed (through the debugger), a normal button must be pressed once only, and a "Buy now" must never be re-pressed.
//   node tests/e2e-trusted.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TRUSTED_PORT || 4177);
const BASE = `http://127.0.0.1:${PORT}`;
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-trusted-ext-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", "127.0.0.1:8999"));
}
const server = http.createServer((req, res) => {
  const file = path.join(here, "fixtures", path.basename(new URL(req.url, BASE).pathname) || "trusted.html");
  res.setHeader("Content-Type", "text/html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1");

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-trusted-prof-")), {
  headless: false, args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/trusted.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(400);
  const say = async (cmd) => {
    const before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0));
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 15000 });
  };
  const out = () => page.textContent("#out");
  const status = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
  const trustedCount = () => page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.trusted || 0));

  await say("click plain menu");
  await page.waitForTimeout(1200);
  check("a normal button is pressed exactly once", (await out()).includes("plain=1"), await out());
  check("...and no real click was needed", (await trustedCount()) === 0, String(await trustedCount()));
  check("the on-screen pointer was shown", await page.evaluate(() => !!document.querySelector("#voicenav-host").shadowRoot.querySelector(".ripple, #cursor.show")));

  // a menu opener (aria-haspopup) that ignores scripted clicks is pressed for real automatically, once
  await say("click popup menu");
  await page.waitForTimeout(2200);
  check("a menu button that ignores scripted clicks gets a real click automatically", (await out()).includes("popup=1"), `${await out()} | ${await status()}`);
  check("...exactly once", (await out()).includes("popup=1") && (await trustedCount()) === 1, `${await out()} trusted=${await trustedCount()}`);

  // any other button is only repeated for real when you ask again (a scripted click can work invisibly)
  await say("click picky menu");
  await page.waitForTimeout(1200);
  check("a plain button that ignored the first press is not pressed twice by itself", (await out()).includes("picky=0") && (await trustedCount()) === 1, `${await out()} trusted=${await trustedCount()}`);
  await say("click picky menu");
  await page.waitForTimeout(1500);
  check("saying it again presses it for real", (await out()).includes("picky=1") && (await trustedCount()) === 2, `${await out()} trusted=${await trustedCount()}`);

  await say("click buy now");
  await page.waitForTimeout(1000);
  check("'Buy now' asks first and is not pressed", (await out()).includes("risky=0") && /confirm|sure|yes/i.test(await status()), `${await out()} | ${await status()}`);
  await say("cancel");
  check("...and still not pressed after cancelling", (await out()).includes("risky=0"), await out());

  await say("stop using real clicks");
  const before = await trustedCount();
  await say("click popup menu");
  await say("click popup menu");
  await page.waitForTimeout(1800);
  check("with real clicks off nothing is pressed for real", (await trustedCount()) === before, `trusted=${await trustedCount()}`);
  await say("use real clicks");
  check("'use real clicks' turns it back on", /Real clicks on/i.test(await status()), await status());

  // real key presses (shortcuts), and the Docs voice-typing command refusing politely off Docs
  await say("press control shift s");
  await page.waitForTimeout(800);
  check("'press control shift s' sends a genuine Ctrl+Shift+S", (await page.textContent("#keys")).includes("T:CSS"), await page.textContent("#keys"));
  await say("press down arrow");
  await page.waitForTimeout(800);
  check("'press down arrow' sends a genuine ArrowDown", (await page.textContent("#keys")).includes("T:ArrowDown"), await page.textContent("#keys"));
  await say("start voice typing");
  check("'start voice typing' says it is a Google Docs feature elsewhere", /Google Docs/.test(await status()), await status());

  // guided tour: a card, plus the same text handed to the speech synthesiser
  await say("describe this page");
  const card = await page.evaluate(() => { const c = document.querySelector("#voicenav-host").shadowRoot.getElementById("card"); return c.hidden ? "" : c.textContent; });
  const spoke = await page.evaluate(() => document.querySelector("#voicenav-host").dataset.spoke || "");
  check("'describe this page' shows a card with the page's heading", /Trusted click test/.test(card), card.slice(0, 200));
  check("...and speaks an overview that names the page and its buttons", /You are on 127\.0\.0\.1/.test(spoke) && /Picky menu/.test(spoke), spoke);
  await say("stop reading");
  check("'stop reading' stops it", /Stopped/.test(await status()), await status());
} catch (e) { console.log("ERROR", e.message.split("\n")[0]); failed++; }
finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await ctx.close(); server.close();
  process.exit(failed ? 1 : 0);
}
