// Tabs that were open before the extension was installed or reloaded must get VoiceNav without a page refresh, and a leftover
// copy of the script must hand over to the new one (never two pills, never two microphones).
//   node tests/e2e-reload.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RELOAD_PORT || 4178);
const BASE = `http://127.0.0.1:${PORT}`;
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-reload-ext-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", "127.0.0.1:8999"));
}
const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<title>t</title><body style='height:3000px'><h1>hello</h1></body>"); }).listen(PORT, "127.0.0.1");

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-reload-prof-")), {
  headless: false, args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const inject = () => sw.evaluate(() => injectIntoOpenTabs());
  // run something in the extension's own page world (where the content script lives), as the real injection would
  const inWorld = (what) => sw.evaluate(async (w) => {
    const [t] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
    return chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: (w2) => { delete window.__voicenav; if (w2 === "wipe") document.getElementById("voicenav-host")?.remove(); },
      args: [w],
    });
  }, what);
  const hosts = () => page.evaluate(() => document.querySelectorAll("#voicenav-host").length);

  // 1. a second injection into a tab that already has a live copy changes nothing
  await page.evaluate(() => { document.querySelector("#voicenav-host").dataset.marker = "first"; });
  await inject();
  await page.waitForTimeout(500);
  check("injecting into a tab that already has VoiceNav leaves exactly one pill", (await hosts()) === 1, String(await hosts()));
  check("...and keeps the original", await page.evaluate(() => document.querySelector("#voicenav-host").dataset.marker === "first"));

  // 2. a tab with no VoiceNav at all (opened before install) gets it, no refresh
  await inWorld("wipe");
  check("a tab with no VoiceNav shows no pill", (await hosts()) === 0);
  await inject();
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 5000 }).catch(() => {});
  check("injecting brings the pill back without a page refresh", (await hosts()) === 1, String(await hosts()));
  const before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: "scroll down" })));
  await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  check("...and it works (scroll down)", (await page.evaluate(() => scrollY)) > 100, String(await page.evaluate(() => scrollY)));

  // 3. a leftover copy (new world after an extension reload) is replaced, not doubled
  await page.evaluate(() => { document.querySelector("#voicenav-host").dataset.marker = "old"; });
  await inWorld("forget");
  await inject();
  await page.waitForTimeout(800);
  check("a leftover copy is replaced: still exactly one pill", (await hosts()) === 1, String(await hosts()));
  check("...and it is the new one", await page.evaluate(() => document.querySelector("#voicenav-host").dataset.marker !== "old"));
} catch (e) {
  console.log("ERROR", e.message.split("\n")[0]);
  failed++;
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await ctx.close();
  server.close();
  process.exit(failed ? 1 : 0);
}
