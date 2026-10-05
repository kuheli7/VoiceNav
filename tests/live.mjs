// Exploratory test on real websites. Loads the real extension (with the test hook on, in a temp copy) into a throwaway
// browser profile with no login, then "speaks" commands and reports what happened.
//
//   node tests/live.mjs youtube
//   node tests/live.mjs amazon
//
// Read-only except Add to Cart on a guest cart. It never goes near checkout. Real sites change and may show
// bot checks, so this reports observations; it isn't a pass/fail gate like e2e.mjs.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
if (!["youtube", "amazon"].includes(site)) { console.log("usage: node tests/live.mjs youtube|amazon"); process.exit(2); }

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-live-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
const src = fs.readFileSync(cs, "utf8");
if (!src.includes("const TEST_HOOK = false;")) throw new Error("TEST_HOOK flag not found");
fs.writeFileSync(cs, src.replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));

// BACKEND_PORT lets the test copy of the extension talk to a different backend than the one you use day to day
const port = process.env.BACKEND_PORT || "8000";
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${port}`));
}
const backendUp = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).then((h) => h.ok).catch(() => false);
console.log(`AI backend on port ${port}: ${backendUp ? "running" : "NOT running (AI-dependent commands will fail)"}\n`);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-liveprof-")), {
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--autoplay-policy=no-user-gesture-required"],
});

let page = await ctx.newPage(); // reassigned when a click opens a new tab
const tally = { OK: 0, FAIL: 0 };
const log = (label, detail = "") => { if (label in tally) tally[label]++; console.log(`${label.padEnd(8)} ${detail}`); };

const hostReady = () => page.waitForSelector("#voicenav-host", { state: "attached", timeout: 25000 }).then(() => true).catch(() => false);
const panel = (fn) => page.evaluate(fn).catch(() => null);
const status = () => panel(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
const heard = () => panel(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("heard").textContent);
const badges = () => panel(() => document.querySelector("#voicenav-host").shadowRoot.querySelectorAll(".badge").length);

// Say a command and report what the extension did. Some commands navigate, which destroys the page mid-call.
async function say(cmd, { expectNav = false, timeout = 60000 } = {}) {
  // Real sites sometimes reload themselves just after load; wait for the extension to be back on the page
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 }).catch(() => {});
  let before = 0;
  try { before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0)); } catch {}
  const t0 = Date.now();
  try {
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
  } catch (e) {
    if (!expectNav) log("WARN", `"${cmd}" did not finish cleanly: ${e.message.split("\n")[0]}`);
    return { navigated: true };
  }
  const s = await status(), h = await heard();
  log("SAID", `"${cmd}"  ->  ${s}   [${(h || "").replace(/^Heard: "[^"]*"\s*/, "") || "local"}, ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  return { status: s };
}

const blocked = async () => {
  const body = (await panel(() => document.body?.innerText?.slice(0, 600))) || "";
  return /enter the characters|not a robot|captcha|unusual traffic|automated access/i.test(body);
};

try {
  if (site === "youtube") {
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!(await hostReady())) throw new Error("VoiceNav did not load on YouTube");
    log("PAGE", `youtube home loaded: ${await page.title()}`);
    await page.waitForTimeout(3000);

    await say("show numbers");
    log("INFO", `${await badges()} elements numbered on the home page`);
    await say("hide numbers");

    await Promise.all([
      page.waitForURL(/search_query=/, { timeout: 20000 }).then(() => log("OK", "search navigated to results")).catch(() => log("FAIL", `search did not navigate; url=${page.url()}`)),
      say("search for lofi hip hop", { expectNav: true }),
    ]);
    await page.waitForSelector("ytd-video-renderer", { timeout: 20000 }).catch(() => log("WARN", "no video results rendered"));
    await page.waitForTimeout(1500);

    await say("show numbers");
    log("INFO", `${await badges()} elements numbered on the results page`);
    await say("hide numbers");

    const firstTitle = await panel(() => document.querySelector("ytd-video-renderer a#video-title")?.textContent?.trim());
    log("INFO", `first result on the page is: "${firstTitle}"`);
    await say("open the first video");
    await page.waitForURL(/\/watch\?v=/, { timeout: 15000 }).then(() => log("OK", `opened a video: ${page.url()}`)).catch(() => log("FAIL", `did not reach a watch page; url=${page.url()}`));
    await page.waitForSelector("video", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);

    const v = () => panel(() => { const m = document.querySelector("video"); return m ? { paused: m.paused, muted: m.muted, t: +m.currentTime.toFixed(1) } : null; });
    log("INFO", `video state at start: ${JSON.stringify(await v())}`);
    await say("pause");
    const afterPause = await v();
    log(afterPause?.paused ? "OK" : "FAIL", `after "pause": ${JSON.stringify(afterPause)}`);
    await say("play");
    await page.waitForTimeout(1500);
    const afterPlay = await v();
    log(afterPlay && !afterPlay.paused ? "OK" : "FAIL", `after "play": ${JSON.stringify(afterPlay)}`);
    await say("mute");
    log((await v())?.muted ? "OK" : "FAIL", `after "mute": ${JSON.stringify(await v())}`);
    await say("unmute");

    await say("scroll down slowly");
    await page.waitForTimeout(1500);
    const y1 = await panel(() => scrollY);
    await page.waitForTimeout(1500);
    const y2 = await panel(() => scrollY);
    log(y2 > y1 && y1 > 0 ? "OK" : "FAIL", `"scroll down slowly": scrollY ${y1} -> ${y2}`);
    await say("stop");
    const y3 = await panel(() => scrollY);
    await page.waitForTimeout(800);
    log((await panel(() => scrollY)) === y3 ? "OK" : "FAIL", `"stop" holds position at ${y3}`);
    await say("go to the top");

    await say("go back", { expectNav: true });
    await page.waitForTimeout(2500);
    log(/search_query=/.test(page.url()) ? "OK" : "FAIL", `"go back" returned to: ${page.url()}`);

    // "type" then "press enter" in YouTube's own search box (a form whose button is labelled "Search")
    await page.evaluate(() => document.activeElement?.blur()).catch(() => {});
    await say("type piano music");
    await Promise.all([
      page.waitForURL(/search_query=piano/, { timeout: 20000 }).then(() => log("OK", `"type piano music" + "press enter" searched: ${page.url()}`))
        .catch(() => log("FAIL", `"press enter" did not search; url=${page.url()}`)),
      say("press enter", { expectNav: true }),
    ]);
  }

  if (site === "amazon") {
    // Product-page steps, usable after a search or (with AMAZON_PRODUCT=/dp/...) straight from a product URL
    let cards = null; // filled in by the search flow, used by the product flow
    const productFlow = async () => {
      if (!(await hostReady())) return;
      await say("show numbers");
      const hasAtc = await panel(() => !!document.querySelector("#add-to-cart-button"));
      log("INFO", `${await badges()} elements numbered on the product page; #add-to-cart-button exists: ${hasAtc}`);
      await say("hide numbers");
      const cartBefore = await panel(() => document.querySelector("#nav-cart-count")?.textContent);
      // Who is the real button, and could a person click it right now?
      const atc = await panel(() => {
        const el = document.querySelector("#add-to-cart-button");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], opacity: getComputedStyle(el).opacity, onScreen: r.top >= 0 && r.bottom <= innerHeight, atCenter: top ? `${top.tagName}#${top.id}` : null };
      });
      log("INFO", `#add-to-cart-button: ${JSON.stringify(atc)}`);
      await page.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-dump", { detail: "add to cart" })));
      log("INFO", `what VoiceNav can see labelled "add to cart": ${await panel(() => document.querySelector("#voicenav-host").dataset.dump)}`);
      const pagesBefore = ctx.pages().length;
      await say("click add to cart", { expectNav: true });
      await page.waitForTimeout(4500);
      // Amazon sometimes shows an "Add to your order" warranty upsell instead of going straight to the cart
      const popupOpen = () => panel(() => /Add to your order/i.test(document.body.innerText) && /No thanks/i.test(document.body.innerText));
      const upsell = await popupOpen();
      log("INFO", `after the click: upsell popup shown = ${upsell}`);
      if (upsell) {
        await say("show numbers");
        log("INFO", `${await badges()} elements numbered while the popup is open (the page behind it should NOT be numbered)`);
        await say("hide numbers");
        await say("click no thanks", { expectNav: true });
        await page.waitForTimeout(4500);
        log((await popupOpen()) ? "FAIL" : "OK", `"click no thanks" ${(await popupOpen()) ? "did NOT close the popup" : "closed the popup"}`);
      }
      const cartAfter = await panel(() => document.querySelector("#nav-cart-count")?.textContent);
      const confirmed = await panel(() => /added to cart|added to basket|proceed to checkout|added to your cart/i.test(document.body.innerText));
      log(confirmed || cartAfter !== cartBefore ? "OK" : "FAIL", `add to cart: cart ${cartBefore} -> ${cartAfter}; confirmation text: ${confirmed}; popup handled by voice: ${upsell}; tabs ${pagesBefore} -> ${ctx.pages().length}`);
      await say("scroll down slowly");
      await page.waitForTimeout(1500);
      await say("stop");
      // "type" then "submit" in Amazon's search box from a product page
      await say("go to the top");
      await page.evaluate(() => document.activeElement?.blur()).catch(() => {});
      await say("type usb cable");
      await Promise.all([
        page.waitForURL(/k=usb\+cable/, { timeout: 30000 }).then(() => log("OK", `"type usb cable" + "submit" searched: ${page.url().slice(0, 80)}`))
          .catch(() => log("FAIL", `"submit" did not search; url=${page.url().slice(0, 80)}`)),
        say("submit", { expectNav: true }),
      ]);
    };
    if (process.env.AMAZON_PRODUCT) {
      await page.goto("https://www.amazon.in" + process.env.AMAZON_PRODUCT, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("#productTitle", { timeout: 20000 }).catch(() => log("WARN", "no #productTitle"));
      await productFlow();
    } else {
    await page.goto("https://www.amazon.in/", { waitUntil: "domcontentloaded", timeout: 45000 });
    if (await blocked()) { log("BLOCKED", "Amazon showed a bot check to the automated browser; can't test here."); throw new Error("blocked"); }
    if (!(await hostReady())) throw new Error("VoiceNav did not load on Amazon");
    // A half-rendered home page (or an interstitial) would make every later step meaningless, so stop instead of pressing on
    const home = await page.waitForSelector("#twotabsearchtextbox", { timeout: 25000 }).then(() => true).catch(() => false);
    if (!home) { log("ABORT", `Amazon home page never showed its search box (title "${await page.title()}"); not testing further`); throw new Error("blocked"); }
    log("PAGE", `amazon home loaded: ${await page.title()}`);

    await say("show numbers");
    log("INFO", `${await badges()} elements numbered on the home page`);
    await say("hide numbers");

    await Promise.all([
      page.waitForURL(/\/s\?|k=headphones/, { timeout: 25000 }).then(() => log("OK", "search navigated to results")).catch(() => log("FAIL", `search did not navigate; url=${page.url()}`)),
      say("search for headphones", { expectNav: true }),
    ]);
    if (await blocked()) { log("BLOCKED", "bot check on the results page"); throw new Error("blocked"); }
    if (!(await hostReady())) throw new Error("VoiceNav did not reattach on results page");
    const rendered = await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 20000 }).then(() => true).catch(() => false);
    if (!rendered) { log("ABORT", `no search results rendered; url=${page.url()}`); throw new Error("blocked"); }
    await page.waitForTimeout(1500);

    // What a person would call "the second result", straight from the page
    cards = await panel(() => [...document.querySelectorAll('[data-component-type="s-search-result"]')].slice(0, 4).map((c) => ({
      title: c.querySelector("h2")?.innerText?.trim()?.slice(0, 60),
      price: c.querySelector(".a-price .a-offscreen")?.textContent,
    })));
    log("INFO", `first results on the page: ${JSON.stringify(cards)}`);

    await say("show numbers");
    log("INFO", `${await badges()} elements numbered on the results page`);
    await say("hide numbers");

    const tabsBefore = ctx.pages().length;
    await say("open the second result", { expectNav: true });
    // Amazon opens products in a new tab. Follow it, as the user would.
    await page.waitForTimeout(2500);
    if (ctx.pages().length > tabsBefore) { page = ctx.pages()[ctx.pages().length - 1]; await page.bringToFront(); log("INFO", "the product opened in a NEW TAB; following it"); }
    await page.waitForURL(/\/dp\/|\/gp\/|sspa/, { timeout: 12000 }).catch(() => {});
    log(/\/dp\/|\/gp\/|sspa/.test(page.url()) ? "OK" : "FAIL", `"open the second result" -> ${page.url().slice(0, 100)}  (tabs ${tabsBefore} -> ${ctx.pages().length})`);
    await page.waitForSelector("#productTitle", { timeout: 15000 }).catch(() => log("WARN", "no #productTitle on this page"));
    const opened = await panel(() => document.getElementById("productTitle")?.innerText?.trim()?.slice(0, 70));
    log("INFO", `product page title: "${opened}"   (second result on the list was: "${cards?.[1]?.title}")`);

      await productFlow();
    }
  }
} catch (e) {
  if (e.message !== "blocked") log("ERROR", e.message);
} finally {
  await page.screenshot({ path: path.join(os.tmpdir(), `voicenav-live-${site}.png`) }).catch(() => {});
  log("SHOT", path.join(os.tmpdir(), `voicenav-live-${site}.png`));
  console.log(`\n${site}: ${tally.OK} OK, ${tally.FAIL} FAIL`);
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
