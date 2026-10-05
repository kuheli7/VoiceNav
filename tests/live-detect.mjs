// How well does the universal result detector (extension/detector.js) find the results on real sites it has no rule for?
// Loads each page in a plain throwaway browser (no extension, no login, read-only), runs the detector, and compares what it
// found with a hand-labelled answer (a CSS selector for "the main link of each result", written only for this test).
//
//   node tests/live-detect.mjs dev      sites used while building/tuning the detector
//   node tests/live-detect.mjs A        sites first seen blind
//   node tests/live-detect.mjs B        sites never looked at before the final measurement
//
// A page counts as right when the detected links match the labelled ones (precision and recall both >= 0.8) AND the first
// three are the same, in the same order: that is what "open the second result" depends on.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const detectorPath = path.join(here, "..", "extension", "detector.js");
const detectorCode = fs.readFileSync(detectorPath, "utf8"); // injected with evaluate(), which strict CSP / Trusted Types pages allow (script tags they block)

const POOLS = {
  dev: [
    { name: "amazon.in search", url: "https://www.amazon.in/s?k=headphones", wait: '[data-component-type="s-search-result"]', truth: '[data-component-type="s-search-result"] h2 a, [data-component-type="s-search-result"] a:has(> h2)' },
    { name: "youtube search", url: "https://www.youtube.com/results?search_query=lofi+music", wait: "ytd-video-renderer", truth: "ytd-video-renderer a#video-title" },
    { name: "duckduckgo (html)", url: "https://html.duckduckgo.com/html/?q=python+tutorial", wait: "a.result__a", truth: "a.result__a" },
  ],
  A: [
    { name: "books.toscrape.com catalogue", url: "https://books.toscrape.com/", wait: "article.product_pod", truth: "article.product_pod h3 a" },
    { name: "books.toscrape.com category", url: "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html", wait: "article.product_pod", truth: "article.product_pod h3 a" },
    { name: "webscraper.io test shop", url: "https://webscraper.io/test-sites/e-commerce/static/computers/laptops", wait: ".thumbnail", truth: ".thumbnail a.title" },
    { name: "hacker news front page", url: "https://news.ycombinator.com/", wait: "tr.athing", truth: ".titleline > a:first-of-type" },
    { name: "wikipedia search", url: "https://en.wikipedia.org/w/index.php?search=python+programming&ns0=1&fulltext=1", wait: "li.mw-search-result", truth: "li.mw-search-result .mw-search-result-heading a" },
  ],
  B: [
    { name: "open library search", url: "https://openlibrary.org/search?q=python", wait: "li.searchResultItem", truth: "li.searchResultItem h3.booktitle a" },
    { name: "project gutenberg search", url: "https://www.gutenberg.org/ebooks/search/?query=history", wait: "li.booklink", truth: "li.booklink > a.link" },
    { name: "lobsters front page", url: "https://lobste.rs/", wait: "li.story", truth: "li.story a.u-url" },
    { name: "github trending", url: "https://github.com/trending", wait: "article.Box-row", truth: "article.Box-row h2 a" },
    { name: "dev.to front page", url: "https://dev.to/", wait: "article.crayons-story", truth: "article.crayons-story h3.crayons-story__title a" },
  ],
};

const poolName = process.argv[2];
if (!POOLS[poolName]) { console.log("usage: node tests/live-detect.mjs dev|A|B"); process.exit(2); }

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN" });
const page = await ctx.newPage();
let ok = 0;

for (const site of POOLS[poolName]) {
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const loaded = await page.waitForSelector(site.wait, { timeout: 25000 }).then(() => true).catch(() => false);
    if (!loaded) { console.log(`SKIP  ${site.name.padEnd(30)} page did not render its results (bot check, login wall, or layout change); title "${await page.title()}"`); continue; }
    await page.waitForTimeout(1500);
    await page.evaluate(detectorCode);
    const r = await page.evaluate((truth) => {
      const t0 = performance.now();
      const found = VoiceNavDetector.detect(document);
      const ms = performance.now() - t0;
      const vis = (e) => e.getClientRects().length > 0;
      const want = [...document.querySelectorAll(truth)].filter(vis).map((a) => a.href);
      const got = found ? found.results.map((x) => x.link.href) : [];
      const title = (h) => { const a = [...document.querySelectorAll("a")].find((x) => x.href === h); return a ? (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 38) : h.slice(0, 38); };
      return { want, got, ms, rule: found && found.rule, sampleWant: want.slice(0, 3).map(title), sampleGot: got.slice(0, 3).map(title) };
    }, site.truth);
    const wantSet = new Set(r.want), gotSet = new Set(r.got);
    const hit = r.got.filter((h) => wantSet.has(h)).length;
    const precision = r.got.length ? hit / new Set(r.got).size : 0;
    const recall = r.want.length ? new Set(r.want.filter((h) => gotSet.has(h))).size / new Set(r.want).size : 0;
    const first3 = r.want.length >= 3 && JSON.stringify(r.got.slice(0, 3)) === JSON.stringify(r.want.slice(0, 3));
    const right = precision >= 0.8 && recall >= 0.8 && first3;
    if (right) ok++;
    console.log(`${right ? "PASS" : "FAIL"}  ${site.name.padEnd(30)} labelled ${String(r.want.length).padStart(3)}, detected ${String(r.got.length).padStart(3)}, precision ${precision.toFixed(2)}, recall ${recall.toFixed(2)}, first three ${first3 ? "right" : "WRONG"}, ${r.ms.toFixed(0)} ms, rule ${r.rule ? "yes" : "no"}`);
    if (!right) { console.log(`      labelled starts: ${JSON.stringify(r.sampleWant)}`); console.log(`      detected starts: ${JSON.stringify(r.sampleGot)}`); }
    else if (r.rule) console.log(`      rule: ${r.rule.card}  |  ${r.rule.link}`);
  } catch (e) {
    console.log(`ERROR ${site.name.padEnd(30)} ${e.message.split("\n")[0]}`);
  }
}
console.log(`\npool ${poolName}: ${ok} of ${POOLS[poolName].length} sites right`);
await browser.close();
