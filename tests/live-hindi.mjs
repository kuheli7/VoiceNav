// Hindi and Hinglish commands on real sites, typed through the test hook (no microphone): node tests/live-hindi.mjs youtube|amazon
// Throwaway profile, no login, read-only (nothing is added to a cart). Real sites change, so this reports observations.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
if (!["youtube", "amazon"].includes(site)) { console.log("usage: node tests/live-hindi.mjs youtube|amazon"); process.exit(2); }

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livehi-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
const src = fs.readFileSync(cs, "utf8");
if (!src.includes("const TEST_HOOK = false;")) throw new Error("TEST_HOOK flag not found");
fs.writeFileSync(cs, src.replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
const port = process.env.BACKEND_PORT || "8000";
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${port}`));
}
const backendUp = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).then((h) => h.ok).catch(() => false);
console.log(`AI backend on port ${port}: ${backendUp ? "running" : "NOT running"}\n`);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-livehiprof-")), {
  headless: false, viewport: { width: 1280, height: 800 }, locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--autoplay-policy=no-user-gesture-required"],
});
let page = await ctx.newPage();
const tally = { OK: 0, FAIL: 0 };
const log = (label, detail = "") => { if (label in tally) tally[label]++; console.log(`${label.padEnd(6)} ${detail}`); };
const panel = (fn) => page.evaluate(fn).catch(() => null);
const status = () => panel(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
const heard = () => panel(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("heard").textContent);

async function say(cmd, { expectNav = false, timeout = 60000 } = {}) {
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 }).catch(() => {});
  let before = 0;
  try { before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0)); } catch {}
  try {
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
  } catch (e) {
    if (!expectNav) log("WARN", `"${cmd}" did not finish cleanly: ${e.message.split("\n")[0]}`);
    return;
  }
  log("SAID", `"${cmd}" -> ${await status()}   [${(await heard() || "").replace(/^Heard: /, "")}]`);
}
// a click may open a new tab (Amazon products do): follow it
async function followNewTab(ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const last = ctx.pages()[ctx.pages().length - 1];
    if (last !== page) { page = last; await page.waitForLoadState("domcontentloaded").catch(() => {}); return true; }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

try {
  if (site === "youtube") {
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 25000 });
    await page.waitForTimeout(3000);
    await Promise.all([
      page.waitForURL(/search_query=/, { timeout: 20000 }).then(() => log("OK", `"सर्च करो lofi hip hop" searched: ${page.url()}`)).catch(() => log("FAIL", `search did not navigate; ${page.url()}`)),
      say("सर्च करो lofi hip hop", { expectNav: true }),
    ]);
    await page.waitForSelector("ytd-video-renderer a#video-title", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const firstHref = await panel(() => [...document.querySelectorAll("ytd-video-renderer a#video-title")].find((a) => a.getClientRects().length)?.href);
    await Promise.all([page.waitForURL(/watch\?v=/, { timeout: 20000 }).catch(() => {}), say("पहला वीडियो खोलो", { expectNav: true })]);
    const id = (u) => (u || "").match(/v=([\w-]+)/)?.[1];
    if (id(page.url()) && id(page.url()) === id(firstHref)) log("OK", `"पहला वीडियो खोलो" opened the page's first result (${id(firstHref)})`);
    else log("FAIL", `"पहला वीडियो खोलो": now ${page.url()}, first result was ${firstHref}`);
    await page.waitForSelector("video", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const vid = () => panel(() => { const v = document.querySelector("video"); return v && { paused: v.paused, muted: v.muted }; });
    await say("वीडियो रोको");
    log((await vid())?.paused ? "OK" : "FAIL", `"वीडियो रोको": ${JSON.stringify(await vid())}`);
    await say("video chalao");
    await page.waitForTimeout(1500);
    log((await vid())?.paused === false ? "OK" : "FAIL", `"video chalao": ${JSON.stringify(await vid())}`);
    await say("आवाज़ बंद करो");
    log((await vid())?.muted ? "OK" : "FAIL", `"आवाज़ बंद करो": ${JSON.stringify(await vid())}`);
    await say("dheere dheere neeche scroll karo");
    await page.waitForTimeout(1500);
    const y1 = await panel(() => scrollY);
    await page.waitForTimeout(1500);
    const y2 = await panel(() => scrollY);
    log(y2 > y1 && y1 > 0 ? "OK" : "FAIL", `"dheere dheere neeche scroll karo": scrollY ${y1} -> ${y2}`);
    await say("ruko");
    const y3 = await panel(() => scrollY);
    await page.waitForTimeout(1000);
    log((await panel(() => scrollY)) === y3 ? "OK" : "FAIL", `"ruko" stopped the scroll at ${y3}`);
    await Promise.all([page.waitForURL(/search_query=/, { timeout: 15000 }).catch(() => {}), say("peeche jao", { expectNav: true })]);
    log(/search_query=/.test(page.url()) ? "OK" : "FAIL", `"peeche jao": ${page.url()}`);
  } else {
    await page.goto("https://www.amazon.in/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 25000 });
    await page.waitForTimeout(3000);
    const body = (await panel(() => document.body.innerText.slice(0, 600))) || "";
    if (/enter the characters|captcha|not a robot/i.test(body)) throw new Error("Amazon showed a bot check");
    await Promise.all([
      page.waitForURL(/[?&]k=/, { timeout: 20000 }).then(() => log("OK", `"wireless headphones search karo" searched`)).catch(() => log("FAIL", `search did not navigate; ${page.url()}`)),
      say("wireless headphones search karo", { expectNav: true }),
    ]);
    await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const resultsUrl = page.url(), resultsPage = page;
    // the products as the extension counts them: cards with a title link, sponsored Prime Video skipped, from the first one on screen
    const cards = () => panel(() => [...document.querySelectorAll('[data-component-type="s-search-result"]')]
      .map((c) => ({ asin: c.dataset.asin, link: c.querySelector("h2 a, a:has(> h2)"), price: c.querySelector(".a-price .a-offscreen")?.textContent }))
      .filter((x) => x.link && x.link.getClientRects().length && !(x.link.getAttribute("href") || "").startsWith("/gp/video/"))
      .map((x) => ({ asin: x.asin, price: x.price ? parseFloat(x.price.replace(/[^\d.]/g, "")) : null })));
    const asinOf = (u) => (u || "").match(/\/(?:dp|gp\/product)\/(\w{10})/)?.[1];
    const tryOpen = async (cmd, want, what) => {
      const startPages = ctx.pages().length;
      await Promise.all([page.waitForURL(/\/dp\/|\/gp\/product\//, { timeout: 15000 }).catch(() => {}), say(cmd, { expectNav: true })]);
      if (ctx.pages().length > startPages) await followNewTab();
      const got = asinOf(page.url());
      log(got && got === want ? "OK" : "FAIL", `"${cmd}" (${what}): opened ${got || page.url().slice(0, 80)}, expected ${want}`);
      if (page !== resultsPage) { await page.close(); page = resultsPage; await page.bringToFront(); }
      else { await page.goto(resultsUrl, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000); }
    };
    let list = await cards();
    log("INFO", `${list.length} products counted`);
    if (backendUp) {
      await tryOpen("doosra result kholo", list[1]?.asin, "second product");
      list = await cards();
      await tryOpen("तीसरा प्रोडक्ट खोलो", list[2]?.asin, "third product");
      list = await cards();
      const priced = list.filter((x) => x.price != null).sort((a, b) => a.price - b.price);
      await tryOpen("सबसे सस्ता वाला खोलो", priced[0]?.asin, `cheapest, Rs ${priced[0]?.price}`);
    } else log("INFO", "position/price commands skipped (backend not running)");
    await Promise.all([page.waitForURL(/s=price-asc-rank/, { timeout: 15000 }).catch(() => {}), say("price low to high sort karo", { expectNav: true })]);
    log(/s=price-asc-rank/.test(page.url()) ? "OK" : "FAIL", `"price low to high sort karo": ${page.url().slice(0, 120)}`);
    await page.waitForTimeout(3000);
    await say("थोड़ा नीचे");
    log((await panel(() => scrollY)) > 50 ? "OK" : "FAIL", `"थोड़ा नीचे": scrollY ${await panel(() => scrollY)}`);
  }
} catch (e) {
  log("FAIL", `stopped: ${e.message.split("\n")[0]}`);
} finally {
  console.log(`\n${tally.OK} OK, ${tally.FAIL} FAIL`);
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
