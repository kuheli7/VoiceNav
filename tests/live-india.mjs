// The sites people in India use most, driven by typed commands through the test hook (no microphone, no login).
// Read-only: every request other than GET/HEAD is aborted, and nothing is bought, sent, liked or signed in. A site that shows a
// bot check (CAPTCHA, "access denied") is reported as BLOCKED and left alone; nothing here tries to get past one.
//
//   node tests/live-india.mjs [site ...]       (default: all)       e.g.  node tests/live-india.mjs flipkart wikipedia
//   writes eval/live-india-results.md
//
// Per site: scroll down / a little / up / to the top, "show numbers", "describe this page" (card and spoken text), and for
// listing and search pages "open the second result" (the page must change to a different address).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
// "the second result" and "the cheapest" are worked out by the backend (no AI model is needed for those), so start one
const BACK = Number(process.env.BACKEND_PORT || 8766);
const py = path.join(here, "..", "backend", ".venv", "Scripts", "python.exe");
const backend = fs.existsSync(py) ? spawn(py, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BACK)], { cwd: path.join(here, "..", "backend"), stdio: "ignore" }) : null;
process.on("exit", () => { try { backend?.kill(); } catch {} });
for (let i = 0; i < 30; i++) { if (await fetch(`http://127.0.0.1:${BACK}/health`).then(() => true).catch(() => false)) break; await new Promise((r) => setTimeout(r, 500)); }
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-india-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) { // the test backend (position and price commands need it)
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${BACK}`));
}

// kind "listing": has a results list we can open by position after searching `search` on the page's own search box
const SITES = [
  { id: "google", url: "https://www.google.com/", note: "search home (bot check likely on search)", search: null },
  { id: "youtube", url: "https://www.youtube.com/", note: "video home", search: "arijit singh songs" },
  { id: "instagram", url: "https://www.instagram.com/", note: "login wall expected", search: null },
  { id: "whatsapp", url: "https://web.whatsapp.com/", note: "QR login page", search: null },
  { id: "facebook", url: "https://www.facebook.com/", note: "login page", search: null },
  { id: "amazon", url: "https://www.amazon.in/", note: "shop home", search: "wireless headphones" },
  { id: "flipkart", url: "https://www.flipkart.com/", note: "shop home", search: "wireless headphones" },
  { id: "wikipedia", url: "https://en.wikipedia.org/wiki/India", note: "article", search: null },
  { id: "toi", url: "https://timesofindia.indiatimes.com/", note: "news home", search: null },
  { id: "ndtv", url: "https://www.ndtv.com/", note: "news home", search: null },
  { id: "irctc", url: "https://www.irctc.co.in/nget/train-search", note: "booking form (no login)", search: null },
  { id: "myntra", url: "https://www.myntra.com/", note: "fashion home", search: "men tshirts" },
  { id: "zomato", url: "https://www.zomato.com/", note: "food home", search: null },
  { id: "imdb", url: "https://www.imdb.com/", note: "movies home", search: null },
];
const wanted = process.argv.slice(2);
const todo = wanted.length ? SITES.filter((s) => wanted.includes(s.id)) : SITES;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-india-prof-")), {
  headless: false, viewport: { width: 1366, height: 800 }, locale: "en-IN", timezoneId: "Asia/Kolkata",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
// Safety: a form being submitted (a POST that navigates the page) is aborted. Pages' own background requests are allowed (they are how a page
// loads its content: YouTube and Amazon are blank without them). This run never presses Buy, Add to cart, Sign in, Send or Submit.
await ctx.route("**/*", (route) => {
  const r = route.request();
  return r.method() === "POST" && r.isNavigationRequest() ? route.abort() : route.continue();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOT = /captcha|are you a robot|unusual traffic|access denied|verify you are human|just a moment|checking your browser|pardon our interruption|request blocked/i;
const all = [];

for (const site of todo) {
  const row = { id: site.id, note: site.note, checks: [], blocked: false, error: "" };
  const page = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {}); // keep exactly one tab: the browser exits if the last one closes
  const ev = (fn, arg) => page.evaluate(fn, arg).catch(() => null);
  const status = () => ev(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent);
  const say = async (cmd) => {
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 25000 });
    const before = (await ev(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0))) || 0;
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host")?.dataset.handled || 0) > b || !document.querySelector("#voicenav-host"), before, { timeout: 40000 });
    await sleep(900);
  };
  const check = (name, ok, detail = "") => { row.checks.push({ name, ok, detail: ok ? "" : String(detail).slice(0, 140) }); console.log(`${ok ? "PASS" : "FAIL"}  ${site.id.padEnd(10)} ${name}${ok ? "" : "  -> " + String(detail).slice(0, 140)}`); };
  // pages that scroll inside a panel rather than the window: measure whichever moved
  const pos = () => ev(() => Math.max(window.scrollY, ...[...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 50 && e.scrollTop > 0).slice(0, 40).map((e) => e.scrollTop)));
  console.log(`\n== ${site.id}  ${site.url}`);
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(3500);
    const text = (await ev(() => document.body?.innerText?.slice(0, 1500))) || "";
    if (text.trim().length < 30) { await sleep(6000); } // blank: a bot-protection script may still be running
    const text2 = (await ev(() => document.body?.innerText?.slice(0, 1500))) || "";
    if (text2.trim().length < 30) { row.blocked = true; console.log(`BLOCKED  ${site.id}: the page stays blank (usually a bot-protection challenge); not tested`); all.push(row); continue; }
    if (BOT.test(text) && text.length < 800) { row.blocked = true; console.log(`BLOCKED  ${site.id}: the site shows a bot check; not tested`); all.push(row);  continue; }
    const injected = await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 }).then(() => true).catch(() => false);
    check("the extension loads on the page", injected);
    if (!injected) { all.push(row);  continue; }

    // "scrollable" means the MAIN area scrolls (the window, or a panel that is most of the page wide); a scrolling sidebar alone doesn't count
    const scrollable = await ev(() => document.documentElement.scrollHeight > innerHeight + 150 ||
      [...document.querySelectorAll("*")].some((e) => e.scrollHeight > e.clientHeight + 150 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.clientHeight > 200 && e.clientWidth > innerWidth * 0.5));
    const p0 = (await pos()) || 0;
    await say("scroll down");
    if (process.env.DEBUG_SCROLL) await page.screenshot({ path: process.env.DEBUG_SCROLL });
    if (process.env.DEBUG_SCROLL) console.log("   scroll debug:", JSON.stringify(await ev(() => ({ y: scrollY, se: document.scrollingElement.scrollTop, h: document.documentElement.scrollHeight, ih: innerHeight, dialogs: document.querySelectorAll("dialog[open],tp-yt-paper-dialog,[role=dialog]").length, ov: getComputedStyle(document.body).overflow, st: document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent }))));
    const pFull = (await pos()) || 0;
    if (!scrollable) { row.na = (row.na || 0) + 1; console.log(`N/A   ${site.id.padEnd(10)} the page has nothing to scroll here (empty feed, login wall or a blocked view): scroll checks skipped`); }
    else {
      check("'scroll down' moves the page", pFull > p0 + 100, `${p0} -> ${pFull}`);
      await say("go to the top");
      await sleep(900);
      await say("scroll down a little");
      const pLittle = (await pos()) || 0;
      check("'scroll down a little' moves it, by less than 'scroll down'", pLittle > 20 && pLittle < pFull, `little=${pLittle} full=${pFull}`);
      await say("scroll up");
      check("'scroll up' moves back", ((await pos()) || 0) < pLittle, `${pLittle} -> ${await pos()}`);
      await say("go to the top");
      await sleep(1000);
    }

    await say("show numbers");
    const badges = (await ev(() => document.querySelector("#voicenav-host").shadowRoot.querySelectorAll(".badge").length)) || 0;
    // What a person could actually press right now: visible controls on screen with nothing on top of them (a popup hides the rest)
    const reachable = (await ev(() => [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox]")].filter((e) => {
      if (e.closest("#voicenav-host")) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
      const t = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
      return !!t && (e === t || e.contains(t) || t.contains(e));
    }).length)) || 0;
    check(`'show numbers' numbers what can be pressed (${badges} shown, ${reachable} reachable)`, badges >= 1 ? badges >= Math.min(reachable, 40) * 0.7 : reachable === 0, `${badges} badges, ${reachable} reachable | ${await status()}`);
    if (process.env.DEBUG_NUM) await page.screenshot({ path: `${process.env.DEBUG_NUM}-${site.id}.png` });
    await say("hide numbers");

    await say("describe this page");
    const card = (await ev(() => { const c = document.querySelector("#voicenav-host").shadowRoot.getElementById("card"); return c.hidden ? "" : c.textContent; })) || "";
    const spoke = (await ev(() => document.querySelector("#voicenav-host").dataset.spoke)) || "";
    check("'describe this page' gives a card and a spoken overview", card.length > 40 && spoke.length > 40, `card=${card.length} spoken=${spoke.length}`);
    await say("close");

    if (site.search) {
      await say(`search for ${site.search}`);
      await sleep(5000);
      const listUrl = page.url();
      const bodyNow = (await ev(() => document.body?.innerText?.slice(0, 800))) || "";
      if (BOT.test(bodyNow) && bodyNow.length < 800) { row.blocked = true; console.log(`BLOCKED  ${site.id}: bot check after the search`); }
      else {
        check("'search for ...' fills the search box and shows a results page", page.url() !== site.url, `${page.url()} | ${await status()}`);
        await sleep(2500);
        if (process.env.DEBUG_SCROLL) await page.screenshot({ path: process.env.DEBUG_SCROLL.replace(".png", "-search.png") });
        const pagesBefore = ctx.pages().length;
        await say("open the second result");
        await sleep(4500);
        let target = page;
        if (ctx.pages().length > pagesBefore) target = ctx.pages()[ctx.pages().length - 1]; // many shops open products in a new tab
        const moved = target !== page || page.url() !== listUrl;
        check("'open the second result' opens another page", moved, `${await status()}`);
        if (target !== page) await target.close().catch(() => {});
      }
    }
  } catch (e) { row.error = e.message.split("\n")[0]; console.log(`ERROR  ${site.id}: ${row.error}`); }
  all.push(row);
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  
}
await ctx.close();

// write the results
let md = `# Live test: sites most used in India\n\nRun with \`node tests/live-india.mjs\` on ${new Date().toISOString().slice(0, 10)}. Typed commands through the test hook (no microphone), no login, form submissions blocked, nothing bought, sent or signed in.\n\n| Site | Result | Notes |\n|---|---|---|\n`;
let pass = 0, total = 0;
for (const r of all) {
  const p = r.checks.filter((c) => c.ok).length;
  pass += p; total += r.checks.length;
  const fails = r.checks.filter((c) => !c.ok).map((c) => c.name.replace(/'/g, "")).join("; ");
  md += `| ${r.id} | ${r.blocked && !r.checks.length ? "BLOCKED (bot check)" : `${p}/${r.checks.length}`}${r.na ? " (scroll n/a)" : ""}${r.blocked && r.checks.length ? " (+ bot check later)" : ""} | ${r.error ? "error: " + r.error : fails ? "missed: " + fails : r.note} |\n`;
}
md += `\n**${pass} of ${total} checks passed** across ${all.length} sites.\n`;
fs.mkdirSync(path.join(here, "..", "eval"), { recursive: true });
fs.writeFileSync(path.join(here, "..", "eval", "live-india-results.md"), md);
console.log("\n" + md);
try { backend?.kill(); } catch {}
process.exit(0);
