// Real-site check of the new commands on YouTube, Google, GitHub and ChatGPT's logged-OUT page. Typed commands through the test hook
// (no microphone), throwaway browser profile, NO login anywhere, nothing sent to any account. Where a command would press something
// on a real page that touches an account or sends something (Like, Subscribe, ChatGPT's buttons), the test uses a dry run:
// it checks WHICH button would be pressed and presses nothing. Bot checks are reported as SKIP and never worked around.
//   node tests/live-browse.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livebrowse-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) { // an unused port: none of this needs the AI
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${process.env.BACKEND_PORT || "8999"}`));
}

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livebrowse-prof-")), {
  headless: false, viewport: { width: 1366, height: 850 }, locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--autoplay-policy=no-user-gesture-required"],
});
let page = await ctx.newPage();
let passed = 0, failed = 0, skipped = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
const skip = (why) => { console.log(`SKIP  ${why}`); skipped++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sayOn = async (pg, cmd, timeout = 45000) => {
  await pg.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 }).catch(() => {});
  const before = (await pg.evaluate(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0)).catch(() => 0)) || 0;
  try {
    await pg.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await pg.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
  } catch { /* the page was replaced */ }
};
const say = (c, t) => sayOn(page, c, t);
const status = () => page.evaluate(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent).catch(() => null);
const dry = (on) => page.evaluate((v) => { const h = document.querySelector("#voicenav-host"); h.dataset.dry = v ? "1" : "0"; h.dataset.would = ""; }, on);
const would = () => page.evaluate(() => document.querySelector("#voicenav-host").dataset.would);
const sw = async () => ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 10000 }));
const activeUrl = async () => (await sw()).evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);

try {
  // ================================================================ YouTube
  await page.goto("https://www.youtube.com/results?search_query=lofi+music", { waitUntil: "domcontentloaded", timeout: 45000 });
  const haveResults = await page.waitForSelector("ytd-video-renderer a#video-title", { timeout: 25000 }).then(() => true).catch(() => false);
  if (!haveResults) skip("youtube: results did not render");
  else {
    await sleep(2000);
    // consent dialogs are not touched; if one covers the page the video can't be started and the checks say so
    await say("open the second video");
    await page.waitForURL(/watch\?v=/, { timeout: 25000 }).catch(() => {});
    await page.waitForSelector("video", { timeout: 20000 }).catch(() => {});
    await sleep(4000);
    const onWatch = /watch\?v=/.test(page.url());
    check("youtube: 'open the second video' opens a video", onWatch, page.url());
    if (onWatch) {
      const v = (f) => page.evaluate(`(() => { const v = document.querySelector("video.html5-main-video") || document.querySelector("video"); return ${f}; })()`);
      await page.evaluate(() => document.querySelector("video")?.play().catch(() => {}));
      await sleep(1500);
      // ads: a pre-roll ad may be playing; speed and seek apply to whatever is playing, so wait for the ad to be skippable or end
      await say("skip ad"); await sleep(1000);

      await say("speed 1.5");
      check("youtube: 'speed 1.5' changes the video's speed", (await v("v.playbackRate")) === 1.5, `${await v("v.playbackRate")} ${await status()}`);
      await say("make the video faster");
      check("youtube: 'make the video faster'", (await v("v.playbackRate")) === 1.75, `${await v("v.playbackRate")}`);
      await say("normal speed");
      check("youtube: 'normal speed'", (await v("v.playbackRate")) === 1, `${await v("v.playbackRate")}`);
      const t1 = await v("v.currentTime");
      const adOn = await page.evaluate(() => !!document.querySelector(".ad-showing"));
      await say("skip 30 seconds");
      if (adOn) skip("youtube: an ad was playing (a few seconds long), so seeking 30 seconds could not be checked");
      else check("youtube: 'skip 30 seconds'", (await v("v.currentTime")) - t1 > 25, `${t1} -> ${await v("v.currentTime")} ${await status()}`);
      await say("rewind 10 seconds");
      await say("pause");
      check("youtube: 'pause'", await v("v.paused"), await status());
      await say("play");
      await sleep(800);
      check("youtube: 'play'", !(await v("v.paused")), await status());

      await say("theater mode");
      await sleep(1200);
      check("youtube: 'theater mode' toggles theater", await page.evaluate(() => !!document.querySelector("ytd-watch-flexy[theater]")), await status());
      await say("theater mode"); await sleep(600);

      await dry(true);
      await say("like the video");
      check("youtube: 'like the video' would press the VIDEO's like button (not a comment's)", /^like/i.test((await would()) || ""), `would="${await would()}" status="${await status()}"`);
      await dry(false);
      await dry(true);
      await say("click the like button");
      const wouldLike = (await would()) || "";
      check("youtube: even 'click the like button' reaches the video's like button (no 'which one?' among the comment likes)", /like this video/i.test(wouldLike) || /^like/i.test(wouldLike), `would="${wouldLike}" status="${await status()}"`);
      await dry(false);
      await say("subscribe");
      check("youtube: 'subscribe' asks first instead of subscribing", /say "yes"|already subscribed|can't find/i.test((await status()) || ""), await status());
      await say("cancel");

      // the small corner player: leave the video page while it plays, then ask for it back
      await say("go back");
      await sleep(3500);
      const mini = await page.evaluate(() => { const m = document.querySelector("ytd-miniplayer"); return !!m && m.getClientRects().length > 0 && !m.hasAttribute("hidden"); });
      if (!mini) skip("youtube: the corner player did not appear after going back (so 'open the mini player' could not be tried)");
      else {
        await say("open the mini player");
        await page.waitForURL(/watch\?v=/, { timeout: 15000 }).catch(() => {});
        check("youtube: 'open the mini player' brings the video in the corner back (not another video)", /watch\?v=/.test(page.url()), `${page.url()} ${await status()}`);
      }

      await say("full screen");
      await sleep(1500);
      const fsState = await page.evaluate(() => !!document.fullscreenElement);
      const msg = (await status()) || "";
      check("youtube: 'full screen' either works, or says honestly that the browser blocked it and uses the window instead", fsState || /blocked real full screen/i.test(msg), `fullscreenElement=${fsState} status="${msg}"`);
      await say("exit full screen");
      await sleep(800);
    }

    // ---- other tabs
    const [tab2] = await Promise.all([ctx.waitForEvent("page", { timeout: 25000 }).catch(() => null), say("open github in a new tab")]);
    if (!tab2) check("tabs: 'open github in a new tab'", false, await status());
    else {
      await tab2.waitForLoadState("domcontentloaded").catch(() => {});
      check("tabs: 'open github in a new tab' opens github.com", /github\.com/.test(tab2.url()), tab2.url());
      await sleep(1500);
      await sayOn(tab2, "switch to youtube");
      await sleep(900);
      check("tabs: 'switch to youtube' goes to the existing YouTube tab", /youtube\.com/.test(await activeUrl()), await activeUrl());
      await say("switch to github");
      await sleep(900);
      check("tabs: 'switch to github' goes back", /github\.com/.test(await activeUrl()), await activeUrl());
      await sayOn(tab2, "close this tab").catch(() => {});
      await sleep(900);
      check("tabs: 'close this tab' closes it", !ctx.pages().some((p) => /github\.com/.test(p.url())), ctx.pages().map((p) => p.url()).join(" | "));
    }
  }

  // ================================================================ Google: "search", then say it
  page = ctx.pages().find((p) => !p.isClosed()) || (await ctx.newPage());
  await page.bringToFront();
  await page.goto("https://www.google.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 }).catch(() => {});
  if (/sorry|consent/.test(page.url()) || !(await page.$("textarea[name=q], input[name=q]"))) skip("google: no search box (consent page or bot check; not worked around)");
  else {
    await say("search");
    check("google: 'search' puts the cursor in the search box", await page.evaluate(() => /^(?:q)$/.test(document.activeElement?.name || "")), `${await status()} active=${await page.evaluate(() => document.activeElement?.tagName + ":" + document.activeElement?.name)}`);
    await say("python tutorial for beginners");
    await page.waitForURL(/[?&]q=/, { timeout: 15000 }).catch(() => {});
    if (/sorry/.test(page.url())) skip("google: bot check after searching (not worked around)");
    else check("google: what you say next becomes the search", /python/i.test(decodeURIComponent(page.url())), page.url());
  }

  // ================================================================ ChatGPT, logged out: find the icons, press nothing
  const gpt = await ctx.newPage();
  page = gpt;
  await gpt.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await sleep(4000);
  const composer = await gpt.$("#prompt-textarea");
  if (!composer) skip(`chatgpt: no composer on the logged-out page (${gpt.url()}; a login wall or bot check is not worked around)`);
  else {
    await gpt.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 }).catch(() => {});
    await dry(true);
    const labels = async () => { await gpt.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-dump", { detail: "" }))); return JSON.parse(await gpt.evaluate(() => document.querySelector("#voicenav-host").dataset.dump || "[]")); };
    const items = await labels();
    console.log("INFO  chatgpt logged-out buttons seen:", items.filter((i) => i.tag === "BUTTON").map((i) => `${i.label || "(no label)"}${i.hint ? ` [${i.hint}]` : ""}`).slice(0, 25).join(" | "));
    await say("click the plus icon");
    const plus = (await would()) || "";
    check("chatgpt: 'the plus icon' finds the attach button", /add|attach|upload|plus|file/i.test(plus), `would="${plus}" status="${await status()}"`);
    await dry(true);
    await say("click the microphone");
    const mic = (await would()) || "";
    check("chatgpt: 'the microphone' finds the dictate / voice button", /dictat|mic|voice|speech/i.test(mic), `would="${mic}" status="${await status()}"`);
    await dry(true);
    await say("click the mouse");
    const mouse = (await would()) || "";
    check("chatgpt: 'the mouse' (a mishearing of mic) finds it too", /dictat|mic|voice|speech/i.test(mouse), `would="${mouse}" status="${await status()}"`);
    await dry(true);
    await say("search");
    const srch = (await would()) || (await status()) || "";
    check("chatgpt: 'search' finds a search control, or says none is there", /search|can't find/i.test(srch), srch);
    await dry(false);
    await say("scroll up the recent chats");
    console.log(`INFO  chatgpt 'scroll up the recent chats' said: ${await status()}`);
  }
} catch (e) {
  check("test run completed", false, e.stack || e.message);
} finally {
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
