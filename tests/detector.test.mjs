// Tests for the universal result detector on synthetic pages with deliberately awkward structure: generated class names,
// menus and footers that are lists too, a second list in a sidebar, cards with several links, tables, no classes at all.
// Each page marks the links a person would call "the results" with data-vn-main; detection must find exactly those.
//   node tests/detector.test.mjs
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const detectorPath = path.join(here, "..", "extension", "detector.js");

const N = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n");
const nav = `<nav><ul>${N(6, (i) => `<li><a href="/nav${i}">Menu ${i}</a></li>`)}</ul></nav>`;
const footer = `<footer><ul>${N(8, (i) => `<li><a href="/info${i}">About our company ${i}</a></li>`)}</ul></footer>`;
const page = (body, css = "") => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif} .card{margin:8px;padding:8px;border:1px solid #ccc} ${css}</style></head><body>${body}</body></html>`;
const title = (i, what = "Product") => `${what} number ${i} with a reasonably long title`;

const CASES = {
  "product grid with generated class names": (h = "a1b2c3") => ({
    expect: 12,
    html: page(`${nav}<main><div class="css-${h}">${N(12, (i) => `
      <div class="css-${h}x card"><a href="/p/${i}"><img alt="" width="40" height="40"></a>
        <a class="sc-${h}" href="/p/${i}" data-vn-main="${i}"><h3>${title(i)}</h3></a>
        <span class="price">₹${1000 + i}</span><a href="/p/${i}#reviews">4.2 out of 5 stars (${i * 11})</a></div>`)}</div></main>${footer}`),
  }),
  "table of stories with sub-rows (Hacker-News shape)": () => ({
    expect: 15,
    html: page(`<table>${N(15, (i) => `
      <tr class="athing"><td>${i}.</td><td><span class="titleline"><a href="/s/${i}" data-vn-main="${i}">${title(i, "Story")}</a> <a href="/from?site=${i}">(site${i}.com)</a></span></td></tr>
      <tr><td class="subtext"><a href="/u/${i}">user${i}</a> <a href="/c/${i}">${i * 3} comments</a></td></tr>`)}</table>`),
  }),
  "search results with a related-searches sidebar": () => ({
    expect: 10,
    html: page(`${nav}<aside><ul>${N(5, (i) => `<li><a href="/related/${i}">Related search that is long enough ${i}</a></li>`)}</ul></aside>
      <ol>${N(10, (i) => `<li class="result"><h3><a href="/r/${i}" data-vn-main="${i}">${title(i, "Result")}</a></h3><cite>https://site${i}.com</cite><p>snippet text snippet text snippet text</p></li>`)}</ol>${footer}`),
  }),
  "article cards whose 'read more' repeats the same address": () => ({
    expect: 8,
    html: page(N(8, (i) => `<article class="post card"><header><h2><a href="/a/${i}" data-vn-main="${i}">${title(i, "Article")}</a></h2></header><p>excerpt excerpt</p><a class="more" href="/a/${i}">Read the full article</a></article>`)),
  }),
  "video list with thumbnail, title and channel links": () => ({
    expect: 10,
    html: page(`<div>${N(10, (i) => `<div class="video-card card"><a class="thumb" href="/watch?v=${i}"><img alt="" width="60" height="40"><span>12:3${i % 10}</span></a>
      <a class="title" href="/watch?v=${i}" data-vn-main="${i}">${title(i, "Video")} that is quite a bit longer</a><a class="channel" href="/c/${i % 3}">Channel ${i % 3}</a></div>`)}</div>`),
  }),
  "definition list": () => ({
    expect: 7,
    html: page(`<dl>${N(7, (i) => `<dt><a href="/t/${i}" data-vn-main="${i}">${title(i, "Term")}</a></dt><dd>definition ${i}</dd>`)}</dl>`),
  }),
  "alternating and ad classes on the cards": () => ({
    expect: 9,
    html: page(`<div id="results">${N(9, (i) => `<div class="item ${i % 2 ? "odd" : "even"} ${i % 4 === 0 ? "ad" : ""} card"><a href="/i/${i}" data-vn-main="${i}">${title(i, "Item")}</a><p>x</p></div>`)}</div>`),
  }),
  "main list beside a trending sidebar": () => ({
    expect: 10,
    html: page(`<div style="display:flex"><main>${N(10, (i) => `<div class="card"><a href="/m/${i}" data-vn-main="${i}">${title(i, "Main")}</a></div>`)}</main>
      <aside>${N(5, (i) => `<div class="card"><a href="/t/${i}">${title(i, "Trending story")}</a></div>`)}</aside></div>`),
  }),
  "cards that each contain a list of size variants": () => ({
    expect: 6,
    html: page(N(6, (i) => `<div class="card"><a href="/p/${i}" data-vn-main="${i}"><h3>${title(i, "Shoe")}</h3></a>
      <ul>${N(4, (s) => `<li><a href="/p/${i}?size=${s}">Size ${s + 5} UK</a></li>`)}</ul></div>`)),
  }),
  "forum topic rows with author and last-poster links": () => ({
    expect: 12,
    html: page(`<table>${N(12, (i) => `<tr class="topic-row"><td><a href="/topic/${i}" data-vn-main="${i}">${title(i, "Topic")} about something</a></td><td><a href="/u/a${i}">author-${i}</a></td><td><a href="/u/b${i}">last-poster-${i}</a></td></tr>`)}</table>`),
  }),
  "plain divs with no classes at all": () => ({
    expect: 8,
    html: page(`<div id="results">${N(8, (i) => `<div><a href="/x/${i}" data-vn-main="${i}">${title(i, "Plain")}</a><p>text</p></div>`)}</div>`),
  }),
  "grid built from rows of three, with short product names (Bootstrap shape)": () => ({
    expect: 6,
    html: page(`<div class="container">${N(2, (r) => `<div class="row">${N(3, (c) => { const i = (r - 1) * 3 + c; return `<div class="col-md-4"><div class="thumbnail"><img alt="" width="60" height="60"><h4>₹${400 + i}</h4><h4><a class="title" href="/p/${i}" data-vn-main="${i}">Aspire E${i}-510</a></h4><p>short description of the product</p></div></div>`; })}</div>`)}</div>`),
  }),
  "a plain category sidebar (no menu markup) beside the real results": () => ({
    expect: 8,
    html: page(`<div style="display:flex"><div id="side">${N(7, (i) => `<div><a href="/cat/${i}">Category ${i}</a></div>`)}</div><main>${N(8, (i) => `<div class="card"><a href="/m/${i}" data-vn-main="${i}">${title(i, "Main")}</a></div>`)}</main></div>`),
  }),
  "very short product names in headings, each card with a ratings link": () => ({
    expect: 6,
    html: page(["Kindle", "Pixel 9", "iPad", "Echo Dot", "Fire TV", "Galaxy"].map((name, k) => `<div class="card"><img alt="" width="40" height="40"><h3><a href="/p/${k + 1}" data-vn-main="${k + 1}">${name}</a></h3><a href="/p/${k + 1}#r">${1204 + k} ratings</a><span>₹${999 + k}</span></div>`).join("\n")),
  }),
  "a look-alike block elsewhere on the page must not be swept into the saved rule": () => ({
    expect: 10,
    html: page(`<ol class="main">${N(10, (i) => `<li class="result"><a href="/r/${i}" data-vn-main="${i}">${title(i, "Result")}</a><p>snippet</p></li>`)}</ol>
      <ul class="ads"><li class="result"><a href="/ad/1">${title(1, "Sponsored")}</a></li></ul>`),
  }),
  "no results at all: menus, footer and a few links": () => ({
    expect: 0,
    html: page(`${nav}<main><h1>About us</h1><p>We are a company. <a href="/contact">Contact us today</a> or <a href="/jobs">see open jobs</a>.</p></main>${footer}`),
  }),
};

const browser = await chromium.launch({ headless: true });
const pageObj = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };

async function run(html) {
  await pageObj.setContent(html);
  await pageObj.addScriptTag({ path: detectorPath });
  return pageObj.evaluate(() => {
    const r = VoiceNavDetector.detect(document);
    if (!r) return null;
    const want = [...document.querySelectorAll("[data-vn-main]")].map((a) => a.getAttribute("data-vn-main"));
    const got = r.results.map((x) => x.link.getAttribute("data-vn-main"));
    const applied = r.rule ? VoiceNavDetector.apply(r.rule, document).map((x) => x.link.getAttribute("data-vn-main")) : null;
    return { want, got, rule: r.rule, applied };
  });
}

for (const [name, make] of Object.entries(CASES)) {
  const { html, expect } = make();
  const r = await run(html);
  if (expect === 0) { check(name, r === null, JSON.stringify(r && { got: r.got.length, rule: r.rule })); continue; }
  if (!r) { check(name, false, "nothing detected"); continue; }
  const exact = JSON.stringify(r.got) === JSON.stringify(r.want);
  check(name, exact, `found ${r.got.length} (${r.got.slice(0, 6).join(",")}...) want ${r.want.length}`);
  if (r.rule) check(`  its saved rule finds the same results again (${r.rule.card} | ${r.rule.link})`, JSON.stringify(r.applied) === JSON.stringify(r.want), `applied ${r.applied?.length}`);
  else console.log(`NOTE  ${name}: no reusable rule could be derived (detection still works, just not cached)`);
}

// A site redeploys and every generated class name changes: the saved rule should keep working
{
  const a = await run(CASES["product grid with generated class names"]("a1b2c3").html);
  await pageObj.setContent(CASES["product grid with generated class names"]("z9y8x7").html);
  await pageObj.addScriptTag({ path: detectorPath });
  const after = await pageObj.evaluate((rule) => VoiceNavDetector.apply(rule, document).length, a.rule);
  check("a rule survives the site regenerating its CSS class names", !!a.rule && after === 12, `rule=${JSON.stringify(a.rule)} matches after=${after}`);
}

// Speed: a long page must not make a voice command feel slow
{
  const big = page(`<main>${N(400, (i) => `<div class="card"><a href="/p/${i}">${title(i)}</a><span>₹${i}</span><a href="/x/${i}">reviews ${i}</a></div>`)}</main>${footer}`);
  await pageObj.setContent(big);
  await pageObj.addScriptTag({ path: detectorPath });
  const ms = await pageObj.evaluate(() => { const t = performance.now(); const r = VoiceNavDetector.detect(document); return { ms: performance.now() - t, n: r && r.results.length }; });
  check(`detection on a 400-card page takes ${ms.ms.toFixed(0)} ms`, ms.n === 400 && ms.ms < 400, JSON.stringify(ms));
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
