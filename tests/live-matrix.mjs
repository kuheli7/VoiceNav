// Phrasing matrix on real sites: many natural ways of saying the same thing, each checked against what the page did.
//
//   node tests/live-matrix.mjs amazon      (search results: open items by position / name / price)
//   node tests/live-matrix.mjs google      (search results and "People also ask" questions)
//
// Typed commands via the test hook, no microphone. Read-only apart from an anonymous guest cart.
// Set BACKEND_PORT to point the test copy of the extension at a different backend than your everyday one.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
const GROUPS = (process.argv[3] || "A,B,C,D").toUpperCase().split(",");
if (!["amazon", "google", "bing", "ddg"].includes(site)) { console.log("usage: node tests/live-matrix.mjs amazon|google|bing|ddg"); process.exit(2); }

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-matrix-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
const port = process.env.BACKEND_PORT || "8000";
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${port}`));
}
const backendUp = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).then((h) => h.ok).catch(() => false);
console.log(`AI backend on port ${port}: ${backendUp ? "running" : "NOT running"}\n`);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-matrixprof-")), {
  headless: false, viewport: { width: 1280, height: 800 }, locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let page = await ctx.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg).catch(() => null);
const status = () => ev(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent);

async function say(cmd) {
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 }).catch(() => {});
  const before = (await ev(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0))) || 0;
  const t0 = Date.now();
  try {
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 60000 });
  } catch { /* navigation destroyed the page: fine */ }
  return { ms: Date.now() - t0 };
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(50)} ${detail}`);
}

async function closeExtraTabs() {
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
}

try {
  // ---------------------------------------------------------------- AMAZON
  if (site === "amazon") {
    let currentQuery = null;
    const load = async (query = "headphones", force = false) => {
      await closeExtraTabs();
      const same = !force && currentQuery === query && page.url().includes(`k=${encodeURIComponent(query).replace(/%20/g, "+")}`) && !/rh=/.test(page.url());
      if (same) { await page.evaluate(() => scrollTo(0, 0)).catch(() => {}); await sleep(400); return true; }
      await page.goto(`https://www.amazon.in/s?k=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const ok = await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 25000 }).then(() => true).catch(() => false);
      await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 }).catch(() => {});
      await sleep(1200);
      currentQuery = ok ? query : null;
      return ok;
    };
    if (!(await load("headphones", true))) { console.log("ABORT: Amazon results did not render (bot check?)"); throw new Error("abort"); }

    // Titles and prices of every result, in page order, and whether each title is on screen right now
    const readCards = () => ev(() => [...document.querySelectorAll('[data-component-type="s-search-result"]')].map((c) => {
      const a = c.querySelector("h2 a, a:has(> h2)");
      const r = a ? a.getBoundingClientRect() : null;
      if (a && (a.getAttribute("href") || "").startsWith("/gp/video/")) return { title: "" }; // a Prime Video rental, not a product
      return {
        asin: c.getAttribute("data-asin"),
        title: (c.querySelector("h2")?.innerText || "").trim(),
        price: parseFloat((c.querySelector(".a-price .a-offscreen")?.textContent || "").replace(/[^\d.]/g, "")) || null,
        onScreen: !!r && r.width > 4 && r.bottom > 0 && r.top < innerHeight,
      };
    }).filter((c) => c.title));
    const wordList = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);
    const uniqueWords = (cards, i) => {
      const mine = wordList(cards[i].title);
      for (let n = 2; n <= Math.min(8, mine.length); n++) {
        const prefix = mine.slice(0, n).join(" ");
        if (!cards.some((c, j) => j !== i && wordList(c.title).join(" ").includes(prefix))) return cards[i].title.split(/\s+/).slice(0, n).join(" ");
      }
      return null; // every short prefix is shared with another result: asking "which one?" would be the right answer
    };
    const words = (cards, i, n = 3) => cards[i].title.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, n).join(" ");

    // Say a command, then watch for a product page (any tab) or a cart change
    async function openedProduct(cmd) {
      const cartBefore = await ev(() => document.querySelector("#nav-cart-count")?.textContent);
      await say(cmd);
      const said = await status();
      let outcome = "nothing happened", title = null, url = null;
      for (let t = 0; t < 24 && outcome === "nothing happened"; t++) {
        for (const p of ctx.pages()) {
          if (/\/dp\/|\/gp\/(product|aw)|\/sspa\//.test(p.url())) {
            await p.waitForSelector("#productTitle", { timeout: 8000 }).catch(() => {});
            title = await p.evaluate(() => document.getElementById("productTitle")?.innerText?.trim()).catch(() => null);
            outcome = "opened a product"; url = p.url(); break;
          }
        }
        if (outcome !== "nothing happened") break;
        if ((await ev(() => document.querySelector("#nav-cart-count")?.textContent)) !== cartBefore) { outcome = "ADDED TO CART"; break; }
        await sleep(300);
      }
      return { outcome, title, said, url };
    }
    const judge = (name, outcome, title, said, want, wantLabel, extra = {}) => {
      // right product = the title matches, or the product id in the opened URL is the one we expected (titles can differ between list and page)
      const asinOk = !!(extra.asin && extra.url && decodeURIComponent(extra.url).includes(extra.asin));
      const ok = outcome === "opened a product" && ((!!title && title.toLowerCase().includes(want.slice(0, 18).toLowerCase())) || asinOk);
      record(name, ok, `-> ${outcome}${title ? `: "${title.slice(0, 32)}"` : ""}  [want ${wantLabel}: "${want.slice(0, 28)}"]  said: ${(said || "").slice(0, 45)}${ok ? "" : ` | opened ${(extra.url || "none").slice(0, 100)} | expected asin ${extra.asin}`}`);
    };

    // ---- A: top of the page, many phrasings
    if (GROUPS.includes("A")) {
      console.log("== A. top of the page, natural phrasings (headphones)");
      await load("headphones");
      const cards = await readCards();
      cards.slice(0, 4).forEach((c, i) => console.log(`   ${i + 1}. ${c.title.slice(0, 58)}  ${c.price ?? ""}`));
      const priced = cards.map((c, i) => ({ ...c, i })).filter((c) => c.price != null);
      const cheapest = priced.reduce((x, y) => (y.price < x.price ? y : x));
      const dearest = priced.reduce((x, y) => (y.price > x.price ? y : x));
      const cases = [
        ["open the first item", 0], ["view the second item", 1], ["I just want to view the second item", 1],
        ["I want to see the third product", 2], ["show me the third product", 2], ["take me to the first result", 0],
        ["go to the second product page", 1], ["click on the third result", 2], ["look at the fourth one", 3],
        ["see more about the second one", 1], ["can you open the first one please", 0], [`open ${uniqueWords(cards, 1) ?? words(cards, 1)}`, 1],
        [`view the ${uniqueWords(cards, 2) ?? words(cards, 2)} one`, 2], [`I want to look at ${uniqueWords(cards, 0) ?? words(cards, 0)}`, 0], ["open the cheapest one", cheapest.i],
        ["view the most expensive result", dearest.i], ["I'd like to see the cheapest item", cheapest.i],
      ];
      for (const [cmd, exp] of cases) {
        await load("headphones");
        const r = await openedProduct(cmd);
        judge(cmd, r.outcome, r.title, r.said, cards[exp].title, `#${exp + 1}`);
      }
    }

    // ---- B: scroll first, then act on what is on the screen
    if (GROUPS.includes("B")) {
      console.log("\n== B. scroll down first, then click what is on the screen (headphones)");
      for (const [scrolls, cmd, which] of [
        [1, "open the first item", "first"], [1, "view the second item", "second"], [2, "open the first result", "first"],
        [2, "I want to see the second product", "second"], [3, "click on the first one", "first"], [3, "open the third result", "third"],
      ]) {
        await load("headphones");
        for (let i = 0; i < scrolls; i++) { await say("scroll down"); await sleep(900); }
        const cards = await readCards();
        // Positions count from the first result on screen and carry on below the fold
        const vis = cards.map((c, i) => ({ ...c, i })).slice(Math.max(0, cards.findIndex((c) => c.onScreen)));
        const idx = { first: 0, second: 1, third: 2 }[which];
        const name = `scroll x${scrolls}, "${cmd}"`;
        if (!vis[idx]) { record(name, false, `not enough results on screen (${vis.length}); test setup`); continue; }
        const r = await openedProduct(cmd);
        judge(name, r.outcome, r.title, r.said, vis[idx].title, `${which} on screen`);
      }
    }

    // ---- C: the sidebar filters and the sort control
    if (GROUPS.includes("C")) {
      const fq = process.env.AMAZON_FILTER_QUERY || "laptops";
      console.log("\n== C. sidebar options and sort (" + fq + ")");
      await load(fq, true);
      const side = await ev(() => [...document.querySelectorAll("#s-refinements a, #s-refinements li[aria-label]")]
        .map((e) => {
          const r = e.getBoundingClientRect();
          const label = (e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g, " ");
          return { label, vis: r.width > 4 && r.height > 4 && r.top > 80 && r.bottom < innerHeight };
        }).filter((x) => x.vis && x.label.length > 2 && x.label.length < 45));
      console.log(`   visible sidebar options: ${[...new Set(side.map((x) => x.label))].slice(0, 8).map((l) => `"${l}"`).join(", ")}`);
      const uniq = [...new Set(side.map((x) => x.label))].slice(0, 4);
      for (const label of uniq) {
        for (const phrase of [`click ${label}`, `I want to select ${label}`]) {
          await load(fq, true);
          const before = page.url();
          await say(phrase);
          await sleep(4500);
          const changed = page.url() !== before;
          record(phrase.slice(0, 48), changed, `-> ${changed ? "page changed (filter applied)" : "URL unchanged"}  said: ${((await status()) || "").slice(0, 55)}`);
        }
      }
      // Sort: the real test is whether the results page actually re-sorted (the URL gets an s=price-... parameter)
      for (const phrase of ["sort by price low to high", "I want to sort by price high to low", "sort the results by newest"]) {
        await load(fq, true);
        const before = page.url();
        await say(phrase);
        await sleep(5000);
        const changed = page.url() !== before && /[?&]s=/.test(page.url());
        record(phrase, changed, `-> ${changed ? "re-sorted: " + (page.url().match(/[?&]s=([^&]+)/) || [])[1] : "not re-sorted"}  said: ${((await status()) || "").slice(0, 55)}`);
      }
      await load(fq, true);
      await say("click sort by");
      await sleep(1000);
      const said2 = (await status()) || "";
      await say("price low to high");
      await sleep(5000);
      record("click sort by, then say the option", /[?&]s=price/.test(page.url()), `-> ${page.url().match(/[?&]s=([^&]+)/)?.[1] || "no sort"}  first said: ${said2.slice(0, 60)}`);
    }

    // ---- D: other product types (set AMAZON_QUERIES="a,b,c" to choose which)
    if (GROUPS.includes("D")) {
      const queries = (process.env.AMAZON_QUERIES || "running shoes,python programming book").split(",").map((q) => q.trim()).filter(Boolean);
      for (const query of queries) {
        console.log(`\n== D. ${query}`);
        if (!(await load(query, true))) { console.log("   results did not render"); continue; }
        const cards = await readCards();
        const priced = cards.map((c, i) => ({ ...c, i })).filter((c) => c.price != null);
        const cheapest = priced.length ? priced.reduce((x, y) => (y.price < x.price ? y : x)) : null;
        const dearest = priced.length ? priced.reduce((x, y) => (y.price > x.price ? y : x)) : null;
        const cases = [["open the first item", 0], ["view the second item", 1], ["I just want to see the third one", 2],
                       ["can you please open the fourth result", 3]];
        const named = uniqueWords(cards, 1);
        if (named) cases.push([`I want to look at ${named}`, 1]);
        if (cheapest) cases.push(["open the cheapest one", cheapest.i]);
        if (dearest && cheapest && dearest.i !== cheapest.i) cases.push(["view the most expensive result", dearest.i]);
        for (const [cmd, exp] of cases) {
          if (!cards[exp]) continue;
          await load(query);
          const r = await openedProduct(cmd);
          judge(cmd, r.outcome, r.title, r.said, cards[exp].title, `#${exp + 1}`, { asin: cards[exp].asin, url: r.url });
        }
      }
    }
  }

  // ---------------------------------------------------------------- BING / DUCKDUCKGO (stand-ins for Google, which serves
  // automated browsers a reCAPTCHA). Search from the home page, then open results by position and by name.
  if (site === "bing" || site === "ddg") {
    const HOME = site === "bing" ? "https://www.bing.com/?setlang=en" : "https://duckduckgo.com/?kl=in-en";
    const RESULT = site === "bing" ? "#b_results > li.b_algo" : "article[data-testid=result]";
    const TITLE = site === "bing" ? "h2 a" : "a[data-testid=result-title-a]";
    const q = "how to learn python";
    const blockedNow = () => ev(() => /unusual traffic|not a robot|captcha|verify you are human|unfortunately, bots|solve the challenge|one last step/i.test(document.body.innerText.slice(0, 1500)));
    let resultsUrl = null;

    // 1. "search for ..." typed into the engine's own search box on its home page
    await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 }).catch(() => {});
    await sleep(1500);
    if (await blockedNow()) { console.log(`ABORT: ${site} showed a bot check`); throw new Error("abort"); }
    await say(`search for ${q}`);
    const searched = await page.waitForSelector(RESULT, { timeout: 20000 }).then(() => true).catch(() => false);
    record(`search for ${q}`, searched && /how\+to\+learn\+python|how%20to%20learn%20python/i.test(page.url()), `-> ${page.url().slice(0, 80)}`);
    if (!searched) throw new Error("abort");
    resultsUrl = page.url();

    // Each result's title, address and whether it is on screen
    const readResults = () => ev(([R, T]) => [...document.querySelectorAll(R)].map((r) => {
      const a = r.querySelector(T); if (!a) return null;
      const box = a.getBoundingClientRect();
      const cite = r.querySelector("cite")?.textContent || a.href;
      return { title: a.textContent.trim(), host: (cite.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i) || [""])[0].replace(/^www\./, ""), onScreen: box.width > 4 && box.bottom > 0 && box.top < innerHeight };
    }).filter(Boolean), [RESULT, TITLE]);
    const load = async () => {
      await closeExtraTabs();
      await page.goto(resultsUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector(RESULT, { timeout: 20000 }).catch(() => {});
      await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 }).catch(() => {});
      await sleep(1500);
      // A bot check: stop on this site (never try to get past one)
      if (await blockedNow()) { console.log(`ABORT: ${site} showed a bot check on ${page.url().slice(0, 70)}`); throw new Error("abort"); }
    };
    await load();
    let all = [];
    for (let t = 0; t < 8 && !all.some((r) => r.onScreen); t++) { all = (await readResults()) || []; if (!all.length) await sleep(800); } // Bing redirects once after load
    // Position words count from the first result on screen and carry on below the fold
    const vis = all.slice(Math.max(0, all.findIndex((r) => r.onScreen)));
    if (!all.some((r) => r.onScreen)) {
      console.log(`   (no result on screen; read ${all.length}; url ${page.url().slice(0, 90)}; page says: ${((await ev(() => document.body.innerText)) || "").slice(0, 300).replace(/\s+/g, " ")})`);
      await page.screenshot({ path: path.join(os.tmpdir(), `voicenav-matrix-${site}.png`) });
    }
    vis.slice(0, 4).forEach((r, i) => console.log(`   ${i + 1}. ${r.title.slice(0, 50)}  (${r.host})`));
    const landed = async () => {
      for (let t = 0; t < 30; t++) {
        for (const p of ctx.pages()) {
          const u = p.url();
          if (u && !/bing\.com|duckduckgo\.com|about:blank/.test(u)) return new URL(u).hostname.replace(/^www\./, "");
        }
        await sleep(300);
      }
      return null;
    };
    const cases = [["click the second result", 1], ["open the first result", 0], ["open the third result", 2], ["click on the second one", 1],
      ["I want to see the first result", 0], [`open ${vis[1]?.title.split(/[-|:]/)[0].trim()}`, 1]];
    for (const [cmd, i] of cases) {
      if (!vis[i]) { record(cmd, false, "not enough results"); continue; }
      await load();
      await say(cmd);
      const host = await landed();
      const want = vis[i].host;
      record(cmd, !!host && (host === want || host.endsWith("." + want) || want.endsWith("." + host)), `-> ${host || "stayed on results"}  [want #${i + 1}: ${want}]  said: ${((await status()) || "").slice(0, 50)}`);
    }
  }

  // ---------------------------------------------------------------- GOOGLE
  if (site === "google") {
    const q = "how to learn python";
    const load = async () => {
      await closeExtraTabs();
      await page.goto(`https://www.google.co.in/search?q=${encodeURIComponent(q)}&hl=en`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 }).catch(() => {});
      await sleep(1500);
      const blocked = await ev(() => /unusual traffic|not a robot|captcha|before you continue/i.test(document.body.innerText.slice(0, 800)));
      return !blocked;
    };
    if (!(await load())) { console.log("ABORT: Google showed a consent page or bot check to the automated browser."); await page.screenshot({ path: path.join(os.tmpdir(), "voicenav-matrix-google.png") }); throw new Error("abort"); }

    // The "People also ask" questions: elements whose text is a question and which expand/collapse
    const questions = () => ev(() => [...document.querySelectorAll("[aria-expanded]")]
      .map((e) => ({ text: (e.innerText || "").trim().split("\n")[0], open: e.getAttribute("aria-expanded") === "true" }))
      .filter((x) => x.text.endsWith("?")));
    const qs = await questions();
    console.log(`"People also ask" questions found: ${qs.length}`);
    qs.slice(0, 6).forEach((x, i) => console.log(`  ${i + 1}. ${x.text.slice(0, 70)}`));
    console.log();
    if (qs.length < 3) { await page.screenshot({ path: path.join(os.tmpdir(), "voicenav-matrix-google.png") }); console.log("ABORT: not enough questions on the page to test"); throw new Error("abort"); }

    const exact = (i) => qs[i].text;
    const cases = [
      ["click the second question", 1], ["click on the first question", 0], ["open the third question", 2],
      ["expand the second question", 1], ["I want to open the third question", 2], ["click the fourth question", 3],
      [`click ${exact(1)}`, 1], [`click on ${exact(2).replace(/\?$/, "")}`, 2], [`I want to read ${exact(0)}`, 0],
    ];
    for (const [cmd, expected] of cases) {
      if (expected >= qs.length) continue;
      if (!(await load())) { record(cmd, false, "page failed to load"); continue; }
      await say(cmd);
      await sleep(1200);
      const after = await questions();
      const opened = after.map((x, i) => (x.open ? i : -1)).filter((i) => i >= 0);
      const said = await status();
      record(cmd, opened.length === 1 && opened[0] === expected, `-> expanded question(s): ${opened.map((i) => i + 1).join(",") || "none"}  [want ${expected + 1}]  said: ${(said || "").slice(0, 55)}`);
    }
  }
} catch (e) {
  if (e.message !== "abort") console.log("ERROR", e.message);
} finally {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} phrasings did the right thing`);
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
