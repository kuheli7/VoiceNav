// Real-site check of "what can I say", "read the results" and "undo" on amazon.in and YouTube.
// Typed commands via the test hook, throwaway browser, no login, read-only (no add to cart, nothing typed into accounts).
//   BACKEND_PORT=8003 node tests/live-help.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livehelp-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
const port = process.env.BACKEND_PORT || "8000";
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${port}`));
}

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livehelpprof-")), {
  headless: false, viewport: { width: 1280, height: 800 }, locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let page = await ctx.newPage();
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function say(cmd) {
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 }).catch(() => {});
  const before = (await page.evaluate(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0)).catch(() => 0)) || 0;
  try {
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 60000 });
  } catch { /* the page navigated away */ }
}
const card = () => page.evaluate(() => { const c = document.querySelector("#voicenav-host")?.shadowRoot.getElementById("card"); return c ? { hidden: c.hidden, text: c.textContent } : null; }).catch(() => null);
const status = () => page.evaluate(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent).catch(() => null);

try {
  // ---------------------------------------------------------------- amazon.in
  await page.goto("https://www.amazon.in/s?k=headphones", { waitUntil: "domcontentloaded", timeout: 45000 });
  const ok = await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 25000 }).then(() => true).catch(() => false);
  if (!ok) { console.log("SKIP  amazon.in: results did not render (bot check?)"); }
  else {
    await sleep(1500);
    const real = await page.evaluate(() => [...document.querySelectorAll('[data-component-type="s-search-result"]')].map((c) => (c.querySelector("h2")?.innerText || "").trim()).filter(Boolean).slice(0, 3));
    await say("what can I say");
    let c = await card();
    check("amazon: 'what can I say' shows help, including the results section", !!c && !c.hidden && /list of results/.test(c.text) && /Sorting/.test(c.text), c && c.text.slice(0, 200));
    await say("close");
    check("amazon: 'close' hides it", (await card())?.hidden === true);
    await say("read the results");
    c = await card();
    const firstWords = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
    const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ");
    check("amazon: 'read the results' lists the page's real first results, in order", !!c && real.every((t, i) => norm(c.text).includes(firstWords(t))), `real ${JSON.stringify(real.map(firstWords))}; card ${c && c.text.slice(0, 220)}`);
    await say("close");

    // open the second result: Amazon opens it in a new tab; "undo" should close that tab and bring the results back
    const before = ctx.pages().length;
    await say("open the second result");
    await sleep(3500);
    check("amazon: 'open the second result' opened a new tab", ctx.pages().length === before + 1, `tabs ${before} -> ${ctx.pages().length}`);
    const newTab = ctx.pages()[ctx.pages().length - 1];
    const closing = newTab.waitForEvent("close", { timeout: 10000 }).then(() => true).catch(() => false);
    await say("undo");
    check("amazon: 'undo' closes the product tab again", (await closing) && ctx.pages().length === before, `tabs now ${ctx.pages().length}; said: ${await status()}`);
    check("amazon: and you are back on the results page", /\/s\?/.test(page.url()), page.url());
  }

  // ---------------------------------------------------------------- youtube
  await page.goto("https://www.youtube.com/results?search_query=lofi+music", { waitUntil: "domcontentloaded", timeout: 45000 });
  const yt = await page.waitForSelector("ytd-video-renderer", { timeout: 25000 }).then(() => true).catch(() => false);
  if (!yt) { console.log("SKIP  youtube: results did not render"); }
  else {
    await sleep(2500);
    const resultsUrl = page.url();
    await say("open the first video");
    await page.waitForURL(/\/watch\?v=/, { timeout: 15000 }).catch(() => {});
    check("youtube: opened a video", /\/watch\?v=/.test(page.url()), page.url());
    await sleep(2000); // the click is only counted as navigating after about a second
    await say("undo");
    await sleep(3000);
    check("youtube: 'undo' goes back to the search results", page.url() === resultsUrl || /search_query=/.test(page.url()), `${page.url()} said: ${await status()}`);
  }
} catch (e) {
  check("run completed", false, e.message.split("\n")[0]);
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
