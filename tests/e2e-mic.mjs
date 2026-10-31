// The one-time microphone setup, end to end. The old design listened inside each website, so every new site asked "Allow the
// microphone?" and someone who can't click couldn't answer. Now the extension's own page listens, and its address is asked once.
//
// No --use-fake-ui-for-media-stream here: that flag answers every microphone question automatically and would hide exactly the
// failure this test exists to catch. Nobody answers a prompt in this run, so a prompt anywhere shows up as a stall.
//   - Scenario 1 starts with the extension already allowed (the state after setup.html's one-time answer), puts the voice on in
//     pages from two different sites, and expects no prompt and no stall.
//   - Scenario 2 starts with nothing allowed and expects the setup page, not a prompt in the website.
//   - Scenario 3 removes the offscreen API and expects tabs to listen for themselves, as before.
// What this cannot prove: that Chrome keeps the grant after a real click on Allow (a Playwright run can't click Chrome's own
// prompt, so the grant is written into the profile instead), and what Chrome's speech service transcribes through this path.
//   node tests/e2e-mic.mjs
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MIC_PAGE_PORT || 4181);
const SITE_A = `http://127.0.0.1:${PORT}`, SITE_B = `http://localhost:${PORT}`; // two different origins
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
async function waitFor(fn, ms, step = 200) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, step)); } return null; }

// A fixed key gives the extension a known id, which the profile's permission list needs to name it
const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const der = publicKey.export({ type: "spki", format: "der" });
const KEY = der.toString("base64");
const ID = [...crypto.createHash("sha256").update(der).digest("hex").slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");

// A copy of the extension with the test hook on, the key added, and optionally the offscreen API hidden
function extCopy({ noOffscreen = false } = {}) {
  const dir = tmp("voicenav-mic-ext-");
  fs.cpSync(path.join(here, "..", "extension"), dir, { recursive: true });
  const edit = (f, fn) => { const p = path.join(dir, f); const before = fs.readFileSync(p, "utf8"); const after = fn(before); if (after === before) throw new Error(`nothing to change in ${f}`); fs.writeFileSync(p, after); };
  edit("content.js", (s) => s.replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
  edit("manifest.json", (s) => s.replace('"manifest_version": 3,', `"manifest_version": 3,\n  "key": "${KEY}",`));
  if (noOffscreen) edit("background.js", (s) => s.replace("const hostAvailable = () => !!(chrome.offscreen && chrome.runtime.getContexts);", "const hostAvailable = () => false;"));
  return dir;
}

// The state of a profile in which the extension's address has been allowed to use the microphone
function profile({ granted }) {
  const dir = tmp("voicenav-mic-prof-");
  if (granted) {
    fs.mkdirSync(path.join(dir, "Default"), { recursive: true });
    const prefs = { profile: { content_settings: { exceptions: { media_stream_mic: { [`chrome-extension://${ID},*`]: { last_modified: "13400000000000000", setting: 1 } } } } } };
    fs.writeFileSync(path.join(dir, "Default", "Preferences"), JSON.stringify(prefs));
  }
  return dir;
}

async function launch(extDir, { granted, fakeUi = false }) {
  return chromium.launchPersistentContext(profile({ granted }), {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--use-fake-device-for-media-stream", ...(fakeUi ? ["--use-fake-ui-for-media-stream"] : [])],
  });
}

const server = http.createServer((req, res) => {
  const file = path.join(here, "fixtures", path.basename(new URL(req.url, SITE_A).pathname) || "long.html");
  res.setHeader("Content-Type", "text/html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1");

const host = (page, k) => page.evaluate((key) => document.querySelector("#voicenav-host")?.dataset[key] || "", k);
const status = (page) => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
const micOn = (page) => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("mic").classList.contains("on"));
const clickMic = (page) => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("mic").click());
const permission = (page) => page.evaluate(() => navigator.permissions.query({ name: "microphone" }).then((r) => r.state));
const scrollY = (page) => page.evaluate(() => Math.round(scrollY));
const workerOf = async (ctx) => (ctx.serviceWorkers().find((w) => w.url().includes(ID)) ?? await ctx.waitForEvent("serviceworker", { predicate: (w) => w.url().includes(ID), timeout: 15000 }));
async function open(ctx, url) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  return page;
}

try {
  // ---------- 1. the extension is allowed once; websites are never asked ----------
  console.log("\n-- the extension's address is allowed; no site is asked");
  {
    const ctx = await launch(extCopy(), { granted: true });
    try {
      const sw = await workerOf(ctx);
      const a = await open(ctx, `${SITE_A}/long.html`);
      check("setup: the extension has the id the profile names", sw.url().includes(ID), sw.url());
      await clickMic(a);
      const ready = await waitFor(async () => /^(ready|listening)/.test(await host(a, "hostState")), 15000);
      check("voice turns on without any microphone question being answered", !!ready, `hostState=${await host(a, "hostState")} | ${await status(a)}`);
      check("the listening happens in the extension's page, not the website", (await host(a, "listensIn")) === "host", await host(a, "listensIn"));
      check("the website itself was never given the microphone", (await permission(a)) === "prompt", await permission(a));
      check("no setup tab was opened", !ctx.pages().some((p) => p.url().includes("setup.html")), ctx.pages().map((p) => p.url()).join(" | "));

      // a second site, a different origin, opened afterwards: this is where the old design would have asked again
      const b = await open(ctx, `${SITE_B}/long.html`);
      const followed = await waitFor(() => micOn(b), 8000);
      check("a page on a different site comes up already listening", !!followed, await status(b));
      check("...and the other site is not asked either", (await permission(b)) === "prompt" && !ctx.pages().some((p) => p.url().includes("setup.html")), await permission(b));

      // what is heard goes to the tab in front, and only to it
      await b.bringToFront();
      await new Promise((r) => setTimeout(r, 600));
      await sw.evaluate(() => routeHeard({ alts: ["scroll down"], src: "speech" }));
      const bMoved = await waitFor(async () => (await scrollY(b)) > 100, 8000);
      check("speech reaches the tab in front", !!bMoved, `b=${await scrollY(b)} | ${await status(b)}`);
      check("...and not the tab behind it", (await scrollY(a)) === 0, `a=${await scrollY(a)}`);
      await a.bringToFront();
      await new Promise((r) => setTimeout(r, 600));
      const bBefore = await scrollY(b);
      await sw.evaluate(() => routeHeard({ alts: ["scroll down"], src: "speech" }));
      const aMoved = await waitFor(async () => (await scrollY(a)) > 100, 8000);
      check("switching tabs moves where speech goes", !!aMoved && (await scrollY(b)) === bBefore, `a=${await scrollY(a)} b=${await scrollY(b)} (was ${bBefore})`);

      // VoiceNav's own voice must not be heard and obeyed: speaking pauses the microphone
      await a.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: "speak replies" })));
      const paused = await waitFor(async () => (await host(a, "hostState")) === "paused", 8000, 100);
      if (!paused) console.log("SKIP  pausing while VoiceNav speaks (this browser did not start speaking)");
      else {
        // paused means no retries and no restarts, so any later ready/listening report is the microphone coming back
        const resumed = await waitFor(async () => /^(ready|listening)/.test(await host(a, "hostState")), 15000, 200);
        check("the microphone pauses while VoiceNav speaks, then listens again", !!resumed, `hostState=${await host(a, "hostState")}`);
      }
      await a.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: "stop talking back" })));

      // With no tab to be seen (the browser minimised or covered) nothing can act on what is heard, so the microphone is let go, as
      // the tabs used to do for themselves. A browser driven by Playwright never reports a tab as hidden, even when it is minimised,
      // so the tabs' "hidden" reports are made by hand below. That a tab reports on load and on every visibility change is checked.
      const micState = () => sw.evaluate(() => chrome.storage.session.get("micState")).then((o) => o.micState || {});
      const seen = () => sw.evaluate(() => chrome.storage.session.get("tabsSeen")).then((o) => o.tabsSeen || {});
      const tabId = (page) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());
      const [idA, idB] = [await tabId(a), await tabId(b)];
      const s0 = await seen();
      check("each tab tells the worker it can be seen", s0[idA]?.v === true && s0[idB]?.v === true, JSON.stringify(s0));
      await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const again = await waitFor(async () => ((await seen())[idA]?.at || 0) > s0[idA].at, 5000, 100);
      check("a tab reports again whenever its visibility changes", !!again, JSON.stringify(await seen()));

      // switching tabs is one tab hidden and the next shown, a moment apart: the microphone must not blink off for it
      await sw.evaluate(([x, y]) => { noteTabVisible(x, false, Date.now()); setTimeout(() => noteTabVisible(y, true, Date.now()), 150); }, [idA, idB]);
      await new Promise((r) => setTimeout(r, 2200));
      check("switching tabs does not stop the microphone", (await micState()).state !== "off", JSON.stringify(await micState()));

      await sw.evaluate(([x, y]) => { const at = Date.now(); noteTabVisible(x, false, at); noteTabVisible(y, false, at); }, [idA, idB]);
      const released = await waitFor(async () => (await micState()).state === "off", 10000, 200);
      check("with no tab to be seen the microphone is let go", !!released, JSON.stringify(await micState()));
      check("...and the extension page really has stopped", (await micState()).active === false, JSON.stringify(await micState()));
      const letGoAt = (await micState()).at;
      await sw.evaluate((x) => noteTabVisible(x, true, Date.now()), idA);
      const regained = await waitFor(async () => { const m = await micState(); return m.at > letGoAt && /^(ready|listening)$/.test(m.state); }, 15000, 200);
      check("...and takes it back as soon as a tab can be seen", !!regained, JSON.stringify(await micState()));
      await a.bringToFront();
      await new Promise((r) => setTimeout(r, 600));

      // switching voice off from a tab turns it off for the extension page too
      const yBefore = await scrollY(a);
      await clickMic(a);
      await new Promise((r) => setTimeout(r, 600));
      await sw.evaluate(() => routeHeard({ alts: ["scroll down"], src: "speech" }));
      await new Promise((r) => setTimeout(r, 900));
      check("with voice off, nothing is acted on", (await scrollY(a)) === yBefore && !(await micOn(a)), `y ${yBefore} -> ${await scrollY(a)}`);
    } finally { await ctx.close(); }
  }

  // ---------- 2. nothing is allowed yet: the setup page appears, not a prompt in the website ----------
  console.log("\n-- first use: nothing is allowed yet");
  {
    const ctx = await launch(extCopy(), { granted: false });
    try {
      const sw = await workerOf(ctx);
      const a = await open(ctx, `${SITE_A}/long.html`);
      const opened = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("setup.html"), timeout: 15000 }).catch(() => null);
      await clickMic(a);
      const setup = await opened;
      check("the setup page opens by itself", !!setup, ctx.pages().map((p) => p.url()).join(" | "));
      check("the website was not asked for the microphone", (await permission(a)) === "prompt" && (await host(a, "listensIn")) !== "page", `${await permission(a)} / ${await host(a, "listensIn")}`);
      const told = await waitFor(async () => /needs the microphone once/i.test(await status(a)), 8000);
      check("the page says what happened", !!told, await status(a));
      if (setup) {
        await setup.waitForLoadState("domcontentloaded");
        const state = await waitFor(() => setup.evaluate(() => document.body.dataset.state), 5000);
        check("the setup page is asking (or says it is blocked), not silent", ["asking", "blocked"].includes(state), String(state));
        // when the answer arrives the page tells the worker, which makes the microphone page try again
        const at = async () => (await sw.evaluate(() => chrome.storage.session.get("micState"))).micState?.at || 0;
        await a.bringToFront(); // the microphone page only listens while a tab can be seen; let it settle on "needs the microphone" first
        await new Promise((r) => setTimeout(r, 2500));
        const before = await at();
        await setup.evaluate(() => chrome.runtime.sendMessage({ type: "micGranted" }));
        const retried = await waitFor(async () => (await at()) > before, 8000);
        check("the answer makes the microphone page try again", !!retried, `at ${before} -> ${await at()}`);
      }
    } finally { await ctx.close(); }
  }

  // ---------- 3. a browser without offscreen pages keeps working as before ----------
  console.log("\n-- no offscreen pages: tabs listen for themselves");
  {
    const ctx = await launch(extCopy({ noOffscreen: true }), { granted: false, fakeUi: true });
    try {
      const sw = await workerOf(ctx);
      const a = await open(ctx, `${SITE_A}/long.html`);
      await clickMic(a);
      const own = await waitFor(async () => (await host(a, "listensIn")) === "page", 8000);
      check("the tab starts its own recognizer", !!own, `${await host(a, "listensIn")} | ${await status(a)}`);
      const docs = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
      check("no microphone page was made", docs.length === 0, String(docs.length));
    } finally { await ctx.close(); }
  }
} catch (e) { console.log("ERROR", e.message.split("\n")[0]); failed++; }
finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed ? 1 : 0);
}
