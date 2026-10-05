// Real chat sites, logged out, in a throwaway profile. No login, no credentials, no bot-check solving.
//
//   node tests/live-chat.mjs chatgpt   types and sends ONE harmless prompt ("What is 2 plus 2?") if, and only if, the composer
//                                      is usable without logging in; stops at any login wall, bot check or error
//   node tests/live-chat.mjs claude|gemini   only loads the page and reports whether it is behind a login (types nothing)
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
const URLS = { chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/new", gemini: "https://gemini.google.com/app" };
if (!URLS[site]) { console.log("usage: node tests/live-chat.mjs chatgpt|claude|gemini"); process.exit(2); }

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livechat-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livechatprof-")), {
  headless: false, viewport: { width: 1280, height: 800 }, locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const page = await ctx.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg).catch(() => null);
const status = () => ev(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent);
const shot = path.join(os.tmpdir(), `voicenav-livechat-${site}.png`);
async function say(cmd) {
  const before = (await ev(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0))) || 0;
  const t0 = Date.now();
  await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
  await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 30000 }).catch(() => {});
  console.log(`SAID  "${cmd}" -> ${await status()}  [${Date.now() - t0} ms]`);
  return t0;
}

try {
  await page.goto(URLS[site], { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(8000);
  const text = ((await ev(() => document.body.innerText)) || "").slice(0, 2000);
  const url = page.url();
  console.log(`PAGE  ${url}  title "${await page.title()}"`);
  if (/verify you are human|just a moment|unusual activity|captcha|are you a robot|checking your browser/i.test(text)) {
    console.log("STOP  bot check shown; not attempting it"); throw new Error("stop");
  }
  if (site !== "chatgpt") {
    const login = /accounts\.google\.com|\/login|signin/i.test(url) || /sign in|log in|continue with google|continue with email/i.test(text);
    console.log(login ? "STOP  behind a login (expected); nothing typed" : "INFO  page loaded; not typing (only ChatGPT may be tried)");
    throw new Error("stop");
  }
  // The logged-out page has used both a ProseMirror #prompt-textarea and a plain <textarea>; accept either
  const BOX = "#prompt-textarea, form textarea";
  const composer = await page.waitForSelector(BOX, { state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  if (!composer) { console.log("STOP  no usable composer without logging in"); throw new Error("stop"); }
  const t0 = await say("type What is 2 plus 2?");
  console.log(`INFO  composer now holds: "${await ev(() => (() => { const b = [...document.querySelectorAll("#prompt-textarea, form textarea")].find((e) => e.getClientRects().length); return b ? (b.value ?? b.innerText).trim() : null; })())}"`);
  const t1 = await say("send");
  // Sent = the box is empty again and the prompt shows up in the conversation (outside the box)
  const sentAt = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("#prompt-textarea, form textarea")].find((e) => e.getClientRects().length);
    const left = b ? (b.value ?? b.innerText).trim() : "";
    const shown = [...document.querySelectorAll("main *")].some((e) => e.children.length === 0 && !e.closest("form") && /What is 2 plus 2\?/.test(e.textContent || ""));
    return !/2 plus 2/.test(left) && shown;
  }, null, { timeout: 15000, polling: 50 })
    .then(() => Date.now()).catch(() => null);
  if (!sentAt) {
    const after = ((await ev(() => document.body.innerText)) || "").slice(0, 400).replace(/\s+/g, " ");
    console.log(`FAIL  the message did not appear in the conversation. Page says: ${after}`);
  } else {
    console.log(`OK    message sent; it appeared ${sentAt - t1} ms after "send" (${sentAt - t0} ms after "type")`);
    const reply = await page.waitForFunction(() => /\b(?:is|equals|=)\s*\**4\b|\bfour\b/i.test(document.querySelector("main")?.innerText || ""), null, { timeout: 30000 })
      .then(() => true).catch(() => false);
    console.log(reply ? "OK    ChatGPT replied with 4" : "INFO  no reply containing 4 within 30 s (the send itself worked)");
  }
} catch (e) {
  if (e.message !== "stop") console.log("ERROR", e.message.split("\n")[0]);
} finally {
  await page.screenshot({ path: shot }).catch(() => {});
  console.log(`SHOT  ${shot}`);
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
