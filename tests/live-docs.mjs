// Google Docs by voice command (typed through the test hook, no microphone), on a real document in a SEPARATE test profile.
// You log in once by hand; the login is kept in tests/.profile-docs (git-ignored). No password is ever typed by a script.
//
//   node tests/live-docs.mjs login                       opens the browser: sign in to a THROWAWAY Google account, then close it
//   node tests/live-docs.mjs run "<url of a blank doc>"  runs the checks (types a short line, renames the doc, then renames it back)
//
// Use a blank document in a throwaway account: the run types text into it and renames it (and puts the old name back).
// Nothing is sent, shared or deleted. It also prints what the page looks like, which is what to send back if a check fails.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = path.join(here, ".profile-docs");
const mode = process.argv[2];
const docUrl = process.argv[3];
if (!["login", "run"].includes(mode) || (mode === "run" && !/^https:\/\/docs\.google\.com\/document\//.test(docUrl || ""))) {
  console.log('usage:\n  node tests/live-docs.mjs login\n  node tests/live-docs.mjs run "https://docs.google.com/document/d/.../edit"');
  process.exit(1);
}

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livedocs-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) { // an unused port: these checks must not need the AI
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", "127.0.0.1:8999"));
}

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, viewport: { width: 1400, height: 900 }, locale: "en-IN",
  ignoreDefaultArgs: ["--enable-automation"], // looks less like a robot to Google's sign-in
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] || (await ctx.newPage());

if (mode === "login") {
  await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded" });
  console.log("Sign in to a throwaway Google account in the window, then CLOSE the window. The login is saved for next time.");
  await new Promise((r) => ctx.on("close", r));
  process.exit(0);
}

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
const say = async (cmd) => {
  const before = (await page.evaluate(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0)).catch(() => 0)) || 0;
  await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
  await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 30000 });
  await page.waitForTimeout(700);
};
const status = () => page.evaluate(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent);
const title = () => page.evaluate(() => document.querySelector("input.docs-title-input")?.value ?? null);
const bodyText = () => page.evaluate(() => (document.querySelector(".kix-appview-editor") || document.body).innerText);

try {
  await page.goto(docUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 30000 });
  await page.waitForSelector("input.docs-title-input", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // What the page looks like, to send back if something fails
  const shape = await page.evaluate(() => ({
    url: location.hostname + location.pathname.replace(/\/d\/[^/]+/, "/d/<id>"),
    signedIn: !document.querySelector('a[href*="accounts.google.com/ServiceLogin"]'),
    textIframes: [...document.querySelectorAll("iframe")].map((f) => f.className.slice(0, 40)).filter((c) => /text|event/i.test(c)),
    iframeEditable: (() => { try { const d = document.querySelector("iframe.docs-texteventtarget-iframe").contentDocument; return d.querySelector("[contenteditable]")?.tagName || (d.body.isContentEditable ? "BODY" : "none"); } catch (e) { return "blocked: " + e.message; } })(),
    titleBox: !!document.querySelector("input.docs-title-input"),
    geminiLike: [...document.querySelectorAll('[aria-label*="Gemini" i],[data-tooltip*="Gemini" i]')].slice(0, 6).map((e) => `${e.tagName} ${e.getAttribute("aria-label") || e.getAttribute("data-tooltip")}`),
  }));
  console.log("PAGE SHAPE", JSON.stringify(shape));
  check("signed in and the document opened", shape.signedIn && shape.titleBox, JSON.stringify(shape));

  // typing into the document (nothing focused: it must not go to the title)
  const oldTitle = await title();
  await page.mouse.click(700, 400); // click on the page like a person would, so the editor has focus
  await page.waitForTimeout(500);
  const stamp = `voicenav test ${Date.now() % 100000}`;
  await say(`type ${stamp} in the document`);
  await page.waitForTimeout(1200);
  check("'type ... in the document' puts the text on the page", (await bodyText()).includes(stamp), await status());
  check("...and the title is unchanged", (await title()) === oldTitle, `${oldTitle} -> ${await title()}`);

  // the same with plain "type" while the page is focused
  await page.mouse.click(700, 400);
  const stamp2 = `second ${Date.now() % 100000}`;
  await say(`type ${stamp2}`);
  await page.waitForTimeout(1200);
  check("plain 'type ...' goes to the page, not the title or a side panel", (await bodyText()).includes(stamp2), await status());

  // rename and put the old name back
  await say("rename the document to VoiceNav test doc");
  await page.waitForTimeout(1500);
  check("'rename the document to ...' changes the title", (await title()) === "VoiceNav test doc", `${await title()} | ${await status()}`);
  await say(`rename the document to ${oldTitle || "Untitled document"}`);
  await page.waitForTimeout(1500);

  // Gemini: only report what the click did (no prompt is sent)
  await say("click gemini");
  const g = await status();
  console.log("INFO  'click gemini' said:", g);
  await page.waitForTimeout(2000);
  const panel = await page.evaluate(() => ({ boxes: [...document.querySelectorAll('textarea,[contenteditable=true],[role=textbox]')].map((e) => `${e.tagName} ${(e.getAttribute("aria-label") || e.className || "").toString().slice(0, 40)}`).slice(0, 8) }));
  console.log("INFO  boxes on the page after the click:", JSON.stringify(panel));
  check("'click gemini' did not say it was clicked on nothing", !/couldn'?t|not sure|no match/i.test(g), g);
  await say("close");
} catch (e) {
  console.log("ERROR", e.message.split("\n")[0]);
  failed++;
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await ctx.close();
}
