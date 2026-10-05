// End-to-end test: loads the real extension into Chrome and drives a mock shop page by "speaking" commands.
// Voice input itself is replaced by a test hook (a custom DOM event), because headless Chrome has no microphone.
// The AI cases run only when the backend (and Ollama) are up: see README.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extSrc = path.join(here, "..", "extension");
const PORT = +(process.env.E2E_PORT || 4173); // overridable so two test runs can't collide on the port
const BASE = `http://127.0.0.1:${PORT}`;

// Copy the extension with the test hook switched on. The shipped code keeps it off.
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-ext-"));
fs.cpSync(extSrc, extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
const patched = fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;");
if (patched === fs.readFileSync(cs, "utf8")) throw new Error("TEST_HOOK flag not found in content.js");
fs.writeFileSync(cs, patched);
// BACKEND_PORT lets the test copy of the extension talk to a different backend than the one you use day to day
const port = process.env.BACKEND_PORT || "8000";
for (const f of ["background.js", "manifest.json"]) {
  const file = path.join(extDir, f);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${port}`));
}

const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, BASE).pathname) || "shop.html"; // basename blocks ../ tricks
  const file = path.join(here, "fixtures", name);
  res.setHeader("Content-Type", "text/html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1");

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  ok ? passed++ : failed++;
}

const backendUp = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).then((h) => h.ok).catch(() => false);

// Branded Chrome 137+ ignores --load-extension, so use Playwright's bundled Chromium (npx playwright-core install chromium).
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-prof-")), {
  headless: false, // extensions need a headed browser (or --headless=new); a window will flash up
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

try {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto(`${BASE}/shop.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 }).catch(() => {});
  const loaded = (await page.$("#voicenav-host")) !== null;
  check("extension injected into the page", loaded, "content script did not run (does this Chrome allow --load-extension?)");
  if (!loaded) throw new Error("extension not loaded");

  const status = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
  const text = (sel) => page.evaluate((s) => document.querySelector(s).textContent, sel);
  const say = async (cmd, timeout = 90000) => {
    const before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0));
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
  };

  // numbers
  await say("show numbers");
  const badges = await page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.querySelectorAll(".badge").length);
  check("show numbers overlays every clickable element", badges >= 8, `badges=${badges}`);
  await say("hide numbers");
  check("hide numbers removes them", (await page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.querySelectorAll(".badge").length)) === 0);

  // click by number (items sorted top-to-bottom: 1 search, 2 Go, 3 boAt, 4 Sony)
  await say("click number four");
  check("click by spoken number", (await text("#selected")) === "Sony headphones", await text("#selected"));

  // click by label
  await say("click add to cart");
  check("click by label", (await text("#cart-count")) === "1", await text("#cart-count"));
  await say("add it to my basket");
  check("natural phrasing maps to Add to Cart", (await text("#cart-count")) === "2", await text("#cart-count"));

  // safety confirmation
  await say("click buy now");
  check("risky click asks first", (await text("#order-status")) === "" && /confirm/i.test(await status()), await status());
  await say("cancel");
  check("cancel stops the purchase", (await text("#order-status")) === "" && /cancel/i.test(await status()));
  await say("click buy now");
  await say("yes");
  check("confirmed purchase goes through", (await text("#order-status")) === "ORDER PLACED", await text("#order-status"));

  // popups: only what is inside an open popup can be numbered or clicked, and "close" shuts it
  const badgeCount = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.querySelectorAll(".badge").length);
  await say("click help");
  check("native popup opens by voice", await page.evaluate(() => document.getElementById("help").open));
  await say("show numbers");
  check("popup open: only its own button is numbered", (await badgeCount()) === 1, `badges=${await badgeCount()}`);
  await say("click subscribe"); // an ordinary button behind the popup: it must not be found, so no confirmation is asked
  check("popup open: page behind it is not clickable", !/confirm/i.test(await status()), await status());
  await say("close");
  check("'close' shuts a native popup", !(await page.evaluate(() => document.getElementById("help").open)));
  await say("hide numbers");
  await say("click offers");
  check("custom popup opens by voice", await page.evaluate(() => !document.getElementById("sheet").hidden));
  await say("show numbers");
  check("custom popup open: only its own link is numbered", (await badgeCount()) === 1, `badges=${await badgeCount()}`);
  await say("close");
  check("'close' shuts a custom popup with the Escape key", await page.evaluate(() => document.getElementById("sheet").hidden));
  await say("hide numbers");
  await say("click subscribe");
  check("subscribe asks first", (await text("#sub-status")) === "" && /confirm/i.test(await status()), await status());
  await say("cancel");
  check("cancelled subscribe does nothing", (await text("#sub-status")) === "");

  // typing
  await say("click gift note");
  await say("type happy birthday");
  const note = await page.evaluate(() => document.querySelector("textarea").value);
  check("type into a focused text box", note === "happy birthday", note);

  // scrolling
  await say("scroll down");
  check("scroll down", (await page.evaluate(() => scrollY)) > 100);
  await say("go to the bottom");
  const y = await page.evaluate(() => scrollY);
  check("scroll to bottom", y > 1000, `y=${y}`);
  await say("go to the top");
  check("scroll to top", (await page.evaluate(() => scrollY)) === 0);

  // mishearing: "ad to cart" should still find "Add to Cart" by close spelling
  const cartBefore = +(await text("#cart-count"));
  await say("click ad to cart");
  check("close spelling still finds the button", +(await text("#cart-count")) === cartBefore + 1, await text("#cart-count"));

  // sleeping ignores everything except "wake up"
  await say("go to sleep");
  await say("scroll down");
  check("asleep: commands are ignored", (await page.evaluate(() => scrollY)) === 0 && /sleeping/i.test(await page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("heard").textContent)));
  await say("wake up");
  await say("scroll down");
  check("wake up: commands work again", (await page.evaluate(() => scrollY)) > 100);
  await say("go to the top");

  // wake word mode: only utterances that start with "Nova" or "Computer" count
  await say("use wake word");
  await say("scroll down");
  check("wake word on: plain speech is ignored", (await page.evaluate(() => scrollY)) === 0);
  await say("nova scroll down");
  check("wake word on: 'Nova ...' works", (await page.evaluate(() => scrollY)) > 100);
  await say("computer go to the top");
  await say("computer always listen");
  await say("scroll down");
  check("wake word off again", (await page.evaluate(() => scrollY)) > 100);
  await say("go to the top");

  // continuous scrolling: "scroll down slowly" keeps going until "stop"
  await say("scroll down slowly");
  await page.waitForTimeout(700);
  const y1 = await page.evaluate(() => scrollY);
  await page.waitForTimeout(700);
  const y2 = await page.evaluate(() => scrollY);
  check("'scroll down slowly' keeps moving", y1 > 10 && y2 > y1, `y1=${y1} y2=${y2}`);
  await say("stop");
  const y3 = await page.evaluate(() => scrollY);
  await page.waitForTimeout(500);
  check("'stop' ends the scroll", (await page.evaluate(() => scrollY)) === y3 && y3 >= y2, `y2=${y2} y3=${y3} after=${await page.evaluate(() => scrollY)}`);
  await say("go to the top");

  // the pill can be moved or hidden when it covers something
  const pill = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.querySelector(".panel"));
  const pillState = () => page.evaluate(() => {
    const p = document.querySelector("#voicenav-host").shadowRoot.querySelector(".panel");
    return { pos: `${p.dataset.v}-${p.dataset.h}`, hidden: p.classList.contains("hidden"), compact: p.classList.contains("compact") };
  });
  await say("move panel to the top left");
  check("panel moves by voice", (await pillState()).pos === "top-left", (await pillState()).pos);
  await say("move the pill right");
  check("moving one way keeps the other", (await pillState()).pos === "top-right", (await pillState()).pos);
  await say("move panel to the bottom right");
  await say("hide panel");
  check("hide panel", (await pillState()).hidden);
  await say("show panel");
  check("show panel", !(await pillState()).hidden);
  await page.waitForTimeout(5600);
  check("pill shrinks to the mic when idle", (await pillState()).compact);
  await say("scroll down a bit");
  check("pill grows back when it has something to say", !(await pillState()).compact);
  await say("go to the top");

  // a link that opens in a new tab (Amazon products do) must not leave the mic off in the new tab
  // (The shipped content script asks the background worker "is voice on?" on every page load; we watch those questions
  // and the answers. Real speech recognition can't run in this test browser, so we check the hand-off, not the mic.)
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 10000 }));
  await sw.evaluate(() => {
    globalThis.__asked = [];
    chrome.runtime.onMessage.addListener((m, s) => {
      if (m.type !== "getVoice" || !s.tab) return;
      chrome.storage.session.get("voiceOn").then((o) => globalThis.__asked.push({ tab: s.tab.id, on: !!o.voiceOn }));
    });
    return chrome.storage.session.set({ voiceOn: true }); // as if the user had turned the mic on
  });
  const newTab = ctx.waitForEvent("page", { timeout: 10000 });
  await page.evaluate(() => document.getElementById("newtab").click());
  const opened = await newTab;
  await opened.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  let asked = [];
  for (let t = 0; t < 15 && !asked.some((a) => a.on); t++) { // the question is sent a moment after the page loads
    await opened.waitForTimeout(200);
    asked = await sw.evaluate(() => globalThis.__asked).catch(() => []);
  }
  check("a page opened in a new tab asks whether voice is on, and is told yes", asked.some((a) => a.on), JSON.stringify(asked));
  await opened.close();
  await page.bringToFront();
  await sw.evaluate(() => chrome.storage.session.remove("voiceOn"));

  // unknown with no backend degrades politely (only meaningful when the backend is down)
  if (!backendUp) {
    await say("make me a sandwich");
    check("unknown command without AI says so", /offline|isn't running|not sure/i.test(await status()), await status());
  }

  // AI-backed commands
  if (backendUp) {
    await say("open the cheapest headphones");
    check("AI: cheapest item (resolver)", (await text("#selected")) === "boAt headphones", await text("#selected"));
    await say("open the third result");
    check("AI: ordinal (resolver)", (await text("#selected")) === "JBL headphones", await text("#selected"));
    const cart = +(await text("#cart-count"));
    await say("put this in my cart for later");
    check("AI: free-form command (LLM)", +(await text("#cart-count")) === cart + 1, `cart ${cart} -> ${await text("#cart-count")}`);
  } else {
    console.log("SKIP  AI cases (backend not running)");
  }

  // search navigates, so check last
  await Promise.all([
    page.waitForURL(/q=guitars/, { timeout: 10000 }).then(() => check("search fills the box and submits", true)).catch(() => check("search fills the box and submits", false, page.url())),
    say("search for guitars").catch(() => {}),
  ]);

  // "open the X page" must follow the product link, not press "Add to cart, X"
  await page.goto(`${BASE}/grocery.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  await say("open the fresh mini orange page");
  check("'open the ... page' opens the product", (await text("#opened")) === "orange page", await text("#opened"));
  check("'open ...' did not add anything to the cart", (await text("#cart")) === "0", await text("#cart"));
  await say("click bananas"); // plain "click" is ambiguous between the link and the button, so it asks rather than guessing
  check("ambiguous 'click' asks instead of guessing", /matches/i.test(await status()) && (await text("#cart")) === "0", await status());

  // ---- "scroll down slowly" must keep going: on an app-style page that scrolls inside a panel (the page itself is
  // locked), and when speech recognition delivers "scroll down" and "slowly" as two separate phrases ----
  await page.goto(`${BASE}/scrollpane.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  const pane = () => page.evaluate(() => document.getElementById("pane").scrollTop);
  const rewind = () => page.evaluate(() => { document.getElementById("pane").scrollTop = 0; });
  await say("scroll down slowly");
  await page.waitForTimeout(700);
  const p1 = await pane();
  await page.waitForTimeout(700);
  const p2 = await pane();
  check("'scroll down slowly' keeps going inside a scrolling panel (page itself locked)", p1 > 10 && p2 > p1 + 20, `p1=${p1} p2=${p2}`);
  await say("stop");
  const p3 = await pane();
  await page.waitForTimeout(500);
  check("'stop' ends a panel scroll", (await pane()) === p3, `${p3} -> ${await pane()}`);

  await rewind();
  await say("scroll down"); // first half of the sentence: one jump
  await say("slowly");      // second half: turns it into a continuous scroll
  await page.waitForTimeout(800);
  const q1 = await pane();
  await page.waitForTimeout(800);
  const q2 = await pane();
  check("'scroll down' then 'slowly' (speech split in two) becomes a continuous scroll", q1 > 100 && q2 > q1 + 20, `q1=${q1} q2=${q2}`);
  await say("stop");

  await rewind();
  await page.waitForTimeout(8500); // longer than the 8 s memory of the last scroll
  await say("slowly");
  await page.waitForTimeout(700);
  check("a lone 'slowly' with no scroll just before it does nothing", (await pane()) === 0, `scrollTop=${await pane()}`);
  await say("scroll up slowly"); // nothing above to scroll to: must stop politely, not spin forever
  await page.waitForTimeout(900);
  check("scrolling up at the very top ends with a message instead of spinning", /reached the end/i.test(await status()), await status());

  // ---- A results page: talking naturally, counting from what is on screen, questions, dropdowns, sidebar ----
  await page.goto(`${BASE}/results.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  const reset = () => page.evaluate(() => {
    scrollTo(0, 0);
    document.getElementById("selected").textContent = "none";
    document.getElementById("cart").textContent = "0";
    document.getElementById("filter").textContent = "none";
    document.getElementById("sorted").textContent = "none";
    document.querySelectorAll(".q").forEach((q) => q.setAttribute("aria-expanded", "false"));
  });
  // Titles of the results and which of them are on screen right now, from the page itself
  const view = () => page.evaluate(() => {
    const links = [...document.querySelectorAll(".result a.title")];
    const names = links.map((a) => a.textContent.split(" - ")[0]);
    const vis = links.map((a) => { const r = a.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    return { names, first: vis.indexOf(true), last: vis.lastIndexOf(true) };
  });
  const openQuestions = () => page.evaluate(() => [...document.querySelectorAll(".q")].map((q, i) => (q.getAttribute("aria-expanded") === "true" ? i + 1 : 0)).filter(Boolean));

  // No AI needed: names, filters and dropdowns
  await reset();
  await say("click free delivery");
  check("sidebar option by name", (await text("#filter")) === "free delivery", await text("#filter"));
  await say("I want to select 4 stars");
  check("sidebar option, said conversationally", (await text("#filter")) === "4 stars", await text("#filter"));
  await say("sort by price low to high");
  check("'sort by price low to high' picks the option in a hidden native dropdown", (await text("#sorted")) === "price-asc", await text("#sorted"));
  await say("click sort by");
  check("'click sort by' finds the hidden dropdown and lists its options", /featured/i.test(await status()), await status());
  await say("newest");
  check("the next thing said picks the option", (await text("#sorted")) === "newest", await text("#sorted"));
  await reset();
  await say("click how long does it take to learn python");
  check("a question by its words", JSON.stringify(await openQuestions()) === "[1]", JSON.stringify(await openQuestions()));

  // Needs the AI backend: position commands are resolved there
  if (backendUp) {
    const phrasings = [["open the second item", 1], ["I just want to view the third item", 2], ["look at the first one", 0],
      ["can you please show me the second product", 1], ["take me to the second result", 1], ["I'd like to see the first result", 0]];
    for (const [said, n] of phrasings) {
      await reset();
      const v = await view(); // measured before the command: opening something scrolls it into view
      await say(said);
      const want = v.names[v.first + n];
      check(`"${said}" opens the ${["first", "second", "third"][n]} result on screen`, (await text("#selected")) === want && (await text("#cart")) === "0", `got ${await text("#selected")}, want ${want}, cart ${await text("#cart")}`);
    }
    for (const scrollY of [700, 1200]) {
      for (const [said, n] of [["open the first item", 0], ["view the second item", 1]]) {
        await reset();
        await page.evaluate((y) => scrollTo(0, y), scrollY);
        await page.waitForTimeout(250);
        const v = await view();
        await say(said);
        const want = v.names[v.first + n];
        check(`after scrolling to ${scrollY}px, "${said}" means the one you can see`, (await text("#selected")) === want, `got ${await text("#selected")}, want ${want} (first on screen: ${v.names[v.first]})`);
      }
    }
    await reset();
    await page.evaluate(() => scrollTo(0, 900));
    await page.waitForTimeout(250);
    const lv = await view();
    await say("open the last one");
    check("'the last one' is the last one on screen", (await text("#selected")) === lv.names[lv.last], `got ${await text("#selected")}, want ${lv.names[lv.last]}`);
    await reset();
    await say("open the cheapest one");
    check("the cheapest across the whole page, not just the screen", (await text("#selected")) === "Product 4", await text("#selected"));
    await reset();
    await say("I just want to view the most expensive item");
    check("natural phrasing for price", (await text("#selected")) === "Product 5" && (await text("#cart")) === "0", `${await text("#selected")} cart ${await text("#cart")}`);

    for (const [said, expect] of [["click the second question", "[2]"], ["I want to open the first question", "[1]"], ["expand the fourth question", "[4]"]]) {
      await reset();
      await say(said);
      check(`"${said}" counts questions`, JSON.stringify(await openQuestions()) === expect && (await text("#selected")) === "none", `${JSON.stringify(await openQuestions())} selected=${await text("#selected")}`);
    }
    await reset();
    await say("click the second result");
    const rv = await view();
    check("'result' still means the results, not the questions", (await text("#selected")) === rv.names[rv.first + 1] && (await openQuestions()).length === 0, `${await text("#selected")} questions ${JSON.stringify(await openQuestions())}`);

    // the same title twice (organic and sponsored): opening by name takes one instead of asking
    await reset();
    await page.evaluate(() => scrollTo(0, 2300));
    await page.waitForTimeout(250);
    await say("open Product 7 Wireless Headphones model G7");
    check("opening a product by name when its title is listed twice does not ask", /^Product 7/.test(await text("#selected")) && !/matches/i.test(await status()), `${await text("#selected")} said: ${await status()}`);

    // "art" is a piece of the word "cart": naming it must not press Add to cart
    await reset();
    await say("click art");
    check("a word that is only part of 'Add to cart' does not press it", (await text("#cart")) === "0", `cart=${await text("#cart")} said: ${await status()}`);
    await reset();
    await say("I don't want to add it to my cart, I just want to look at the first one");
    check("a negated request never adds to the cart", (await text("#cart")) === "0", `cart=${await text("#cart")} said: ${await status()}`);

    await reset();
    await say("view the item");
    const badgeTotal = await page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.querySelectorAll(".badge").length);
    check("a vague 'view the item' asks which one and shows numbers", /which one/i.test(await status()) && badgeTotal > 0 && (await text("#selected")) === "none", `${await status()} badges=${badgeTotal}`);

    // ---- A shop the extension has never seen: it works out the layout itself, remembers it, and reuses it ----
    await page.goto(`${BASE}/auto-shop.html`);
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    const autoReset = () => page.evaluate(() => { scrollTo(0, 0); document.getElementById("selected").textContent = "none"; document.getElementById("cart").textContent = "0"; });
    const cases = [["open the second item", "Toaster"], ["I just want to view the third product", "Blender"], ["open the first one please", "Kettle"],
                   ["open the cheapest one", "Iron"], ["view the most expensive result", "Heater"], ["go to the fifth result", "Fan"]];
    for (const [said, want] of cases) {
      await autoReset();
      await say(said);
      check(`unknown layout: "${said}"`, (await text("#selected")) === want && (await text("#cart")) === "0", `got ${await text("#selected")}, want ${want}, cart ${await text("#cart")}`);
    }
    await autoReset();
    await say("open Stainless Steel Electric Kettle");
    check("unknown layout: opening by name still works", (await text("#selected")) === "Kettle", await text("#selected"));
    // the menu, the footer and the "trending" sidebar are lists too: none of them may be counted as results
    await autoReset();
    await say("open the third result");
    check("decoy lists (menu, footer, trending sidebar) are not counted as results", (await text("#selected")) === "Blender", await text("#selected"));

    const rules = async () => sw.evaluate(() => chrome.storage.local.get(null)).then((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("rule:")).map(([k, v]) => [k.slice(5), v])));
    await page.waitForTimeout(2000); // rules are written to storage a moment after being learned
    const saved = (await rules())["127.0.0.1|auto-shop.html|1"];
    check("the learned layout is saved as a small selector rule", !!saved && !!saved.card && !!saved.link && !/function|=>/.test(JSON.stringify(saved)), JSON.stringify(saved));
    const hitsBefore = saved?.hits ?? -1;
    await page.reload();
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(500);
    await autoReset();
    await say("view the second item");
    check("after a reload the saved rule is reused and still right", (await text("#selected")) === "Toaster", await text("#selected"));
    await page.waitForTimeout(2000);
    const after = (await rules())["127.0.0.1|auto-shop.html|1"];
    check("reusing the rule is counted", !!after && after.hits > hitsBefore, `hits ${hitsBefore} -> ${after?.hits}`);
  } else {
    console.log("SKIP  results-page position commands (backend not running)");
  }

  // ---- Hindi and Hinglish, typed in both scripts (Devanagari is what Chrome's hi-IN recognizer writes) ----
  {
    const shadow = (code) => page.evaluate((c) => new Function("root", c)(document.querySelector("#voicenav-host").shadowRoot), code);
    const hostData = (k) => page.evaluate((key) => document.querySelector("#voicenav-host").dataset[key] || "", k);
    const heard = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("heard").textContent);
    await page.goto(`${BASE}/shop.html`);
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    const sy = () => page.evaluate(() => scrollY);

    await say("नीचे स्क्रॉल करो");
    check("hindi: 'नीचे स्क्रॉल करो' scrolls down", (await sy()) > 100, `y=${await sy()}`);
    await say("sabse upar jao");
    check("hindi: 'sabse upar jao' goes to the top", (await sy()) === 0, `y=${await sy()}`);
    await say("सबसे नीचे जाओ");
    check("hindi: 'सबसे नीचे जाओ' goes to the bottom", (await sy()) > 1000, `y=${await sy()}`);
    await say("सबसे ऊपर जाओ");
    await say("char number dabao"); // 1 search, 2 Go, 3 boAt, 4 Sony
    check("hindi: 'char number dabao' clicks number 4", (await text("#selected")) === "Sony headphones", await text("#selected"));
    await say("पांच नंबर पर क्लिक करो");
    check("hindi: 'पांच नंबर पर क्लिक करो' clicks number 5", (await text("#selected")) === "JBL headphones", await text("#selected"));
    const c0 = +(await text("#cart-count"));
    await say("add to cart karo");
    check("hinglish: 'add to cart karo'", +(await text("#cart-count")) === c0 + 1, await text("#cart-count"));
    await say("कार्ट में डालो");
    check("hindi: 'कार्ट में डालो' adds to cart", +(await text("#cart-count")) === c0 + 2, await text("#cart-count"));
    await say("abhi kharido");
    check("hinglish: 'abhi kharido' asks before buying", (await text("#order-status")) === "" && /confirm/i.test(await status()), await status());
    await say("nahi");
    check("hinglish: 'nahi' cancels the purchase", (await text("#order-status")) === "" && /cancel/i.test(await status()), await status());
    await say("help pe click karo");
    const helpOpen = () => page.evaluate(() => document.getElementById("help").open);
    check("hinglish: 'help pe click karo' opens the popup", await helpOpen());
    await say("पॉपअप बंद करो");
    check("hindi: 'पॉपअप बंद करो' closes it", !(await helpOpen()));
    await say("offers pe click karo");
    await say("band karo"); // a custom popup is open: "band karo" closes it
    check("hinglish: 'band karo' closes an open custom popup", await page.evaluate(() => document.getElementById("sheet").hidden), await status());
    await say("gift note pe click karo");
    await say("Happy Diwali likho");
    check("hinglish: 'Happy Diwali likho' types it, case kept", (await page.evaluate(() => document.querySelector("textarea").value)) === "Happy Diwali");
    await say("dheere dheere neeche scroll karo");
    await page.waitForTimeout(700);
    const h1 = await sy();
    await page.waitForTimeout(700);
    const h2 = await sy();
    check("hinglish: 'dheere dheere neeche scroll karo' keeps scrolling", h1 > 10 && h2 > h1, `${h1} -> ${h2}`);
    await say("ruko");
    const h3 = await sy();
    await page.waitForTimeout(500);
    check("hinglish: 'ruko' stops it", (await sy()) === h3, `${h3} -> ${await sy()}`);
    await say("dheere neeche jao");
    await page.waitForTimeout(500);
    await say("band karo"); // nothing open, a scroll running: "band karo" stops the scroll
    const h4 = await sy();
    await page.waitForTimeout(500);
    check("hinglish: 'band karo' during a scroll stops the scroll", (await sy()) === h4, `${h4} -> ${await sy()}`);
    await say("go to the top");
    await say("नंबर दिखाओ");
    check("hindi: 'नंबर दिखाओ' shows numbers", (await badgeCount()) >= 8, `badges=${await badgeCount()}`);
    await say("number hatao");
    check("hinglish: 'number hatao' hides them", (await badgeCount()) === 0);

    // switching the recognizer's language: by voice in either language, and by the chip
    const chip = () => shadow("return root.getElementById(\"lang\").textContent;");
    await say("hindi mein bolo");
    check("'hindi mein bolo' switches to Hindi (setting and chip)", (await hostData("lang")) === "hi-IN" && (await chip()) === "हिं", `${await hostData("lang")} chip=${await chip()}`);
    const stored = await sw.evaluate(() => chrome.storage.local.get("lang")).then((o) => o.lang);
    check("the language is remembered in chrome.storage.local", stored === "hi-IN", stored);
    await say("neeche jao");
    check("Hindi mode: Hinglish still works", (await sy()) > 100);
    await say("go to the top");
    check("Hindi mode: English still works", (await sy()) === 0);
    await page.reload();
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(500);
    check("the language survives a reload", (await hostData("lang")) === "hi-IN", await hostData("lang"));
    await say("अंग्रेजी में बोलो");
    check("'अंग्रेजी में बोलो' switches back to English", (await hostData("lang")) === "en-IN" && (await chip()) === "EN", `${await hostData("lang")} chip=${await chip()}`);
    await say("Hindi may bolo"); // how an English recognizer may hear "Hindi mein bolo"
    check("a likely mis-hearing ('Hindi may bolo') still switches", (await hostData("lang")) === "hi-IN", await hostData("lang"));
    await shadow("root.getElementById(\"lang\").click();");
    check("the language chip switches it back", (await hostData("lang")) === "en-IN", await hostData("lang"));
    // The recognizer restarts with the new language when it is running. This browser has no microphone, so it may refuse
    // to start at all; then only the setting is checked (above).
    await shadow("root.getElementById(\"mic\").click();");
    await page.waitForTimeout(800);
    const micOn = await shadow("return root.getElementById(\"mic\").classList.contains(\"on\");");
    if (micOn && (await hostData("recLang")) === "en-IN") {
      const starts = +(await hostData("recStarts"));
      await say("speak hindi");
      await page.waitForTimeout(800);
      check("switching restarts the recognizer with hi-IN", (await hostData("recLang")) === "hi-IN" && +(await hostData("recStarts")) > starts, `${await hostData("recLang")} starts ${starts} -> ${await hostData("recStarts")}`);
      await say("speak english");
      await shadow("root.getElementById(\"mic\").click();");
    } else {
      console.log(`SKIP  recognizer restart (mic did not stay on in this browser: on=${micOn}, lang=${await hostData("recLang")})`);
      if (micOn) await shadow("root.getElementById(\"mic\").click();");
    }
    await sw.evaluate(() => chrome.storage.local.set({ lang: "en-IN" }));

    // wake word in Devanagari
    await say("use wake word");
    await say("neeche scroll karo");
    check("wake word on: plain Hinglish is ignored", (await sy()) === 0);
    await say("नोवा नीचे स्क्रॉल करो");
    check("wake word on: 'नोवा ...' works", (await sy()) > 100);
    await say("कंप्यूटर always listen");
    await say("go to the top");

    if (backendUp) {
      // position and price commands go to the backend as English
      await page.goto(`${BASE}/results.html`);
      await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
      const v = await view();
      await say("doosra result kholo");
      check("hinglish via AI: 'doosra result kholo' opens the second result", (await text("#selected")) === v.names[v.first + 1] && (await text("#cart")) === "0", `got ${await text("#selected")}, want ${v.names[v.first + 1]}`);
      check("the AI was sent the English form", /open the second result/.test(await heard()), await heard());
      await reset();
      await say("सबसे सस्ता वाला खोलो");
      check("hindi via AI: 'सबसे सस्ता वाला खोलो' opens the cheapest", (await text("#selected")) === "Product 4", await text("#selected"));
      await reset();
      await say("sabse mehnga wala dikhao");
      check("hinglish via AI: 'sabse mehnga wala dikhao' opens the most expensive", (await text("#selected")) === "Product 5" && (await text("#cart")) === "0", `${await text("#selected")} cart ${await text("#cart")}`);
      await reset();
      await say("doosra sawaal kholo");
      check("hinglish via AI: 'doosra sawaal kholo' opens question 2", JSON.stringify(await openQuestions()) === "[2]", JSON.stringify(await openQuestions()));
      await reset();
      await say("free delivery pe click karo");
      check("hinglish: a sidebar filter by name", (await text("#filter")) === "free delivery", await text("#filter"));
      await say("price low to high sort karo");
      check("hinglish: 'price low to high sort karo'", (await text("#sorted")) === "price-asc", await text("#sorted"));

      await page.goto(`${BASE}/auto-shop.html`);
      await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
      for (const [said, want] of [["teesra product kholo", "Blender"], ["सबसे सस्ता वाला खोलो", "Iron"], ["पांचवां रिजल्ट खोलो", "Fan"]]) {
        await page.evaluate(() => { scrollTo(0, 0); document.getElementById("selected").textContent = "none"; });
        await say(said);
        check(`unknown layout, hindi: "${said}"`, (await text("#selected")) === want, `got ${await text("#selected")}, want ${want}`);
      }
    } else {
      console.log("SKIP  Hindi AI cases (backend not running)");
    }

    // search navigates, so last
    await page.goto(`${BASE}/shop.html`);
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await Promise.all([
      page.waitForURL(/q=/, { timeout: 10000 }).then(() => check("hindi: 'सर्च करो हेडफोन' searches, keeping the Devanagari word", decodeURIComponent(page.url()).includes("q=हेडफोन"), page.url())).catch(() => check("hindi: 'सर्च करो हेडफोन' searches", false, page.url())),
      say("सर्च करो हेडफोन").catch(() => {}),
    ]);
  }

  // ---- "what can I say", "read the results", and "undo" ----
  await page.goto(`${BASE}/results.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  const huCard = () => page.evaluate(() => { const c = document.querySelector("#voicenav-host").shadowRoot.getElementById("card"); return { hidden: c.hidden, text: c.textContent }; });
  await page.evaluate(() => scrollTo(0, 0));
  await say("what can I say");
  let hu = await huCard();
  check("'what can I say' shows a help card", !hu.hidden && /scroll down/.test(hu.text), hu.text.slice(0, 120));
  check("the card lists only what this page can do (results and sorting here, no chat box)", /list of results/.test(hu.text) && /Sorting/.test(hu.text) && !/Chat/.test(hu.text), hu.text.slice(0, 300));
  await say("close");
  check("'close' hides the card first", (await huCard()).hidden);
  await say("madad");
  check("'madad' (Hindi) shows it too", !(await huCard()).hidden);
  await say("help band karo");
  check("'help band karo' hides it", (await huCard()).hidden);
  await say("read the results");
  hu = await huCard();
  check("'read the results' lists them in order", !hu.hidden && /1\. Product 1/.test(hu.text) && /2\. Product 2/.test(hu.text), hu.text.slice(0, 200));
  await say("close");

  // undo: a switch, and a dropdown choice
  await say("click gift wrap");
  check("setup: the switch is on", await page.evaluate(() => document.getElementById("gift").checked));
  await say("undo");
  check("'undo' switches it back off", !(await page.evaluate(() => document.getElementById("gift").checked)), await status());
  await say("sort by price low to high");
  check("setup: sorted", (await text("#sorted")) === "price-asc");
  await say("undo");
  check("'undo' puts the dropdown back", (await text("#sorted")) === "featured", await text("#sorted"));

  // undo: typing and scrolling, on a page with a text box
  await page.goto(`${BASE}/shop.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  const huNote = () => page.evaluate(() => document.querySelector("textarea").value);
  await say("undo");
  check("'undo' with nothing done says so", /nothing to undo/i.test(await status()), await status());
  await say("click gift note");
  await say("type hello");
  await say("type goodbye");
  check("setup: typed twice", (await huNote()) === "goodbye", await huNote());
  await say("undo");
  check("'undo' brings back the earlier text", (await huNote()) === "hello", await huNote());
  await say("undo");
  check("a second 'undo' empties the box again", (await huNote()) === "", await huNote());
  await say("type bye bye");
  await say("undo karo");
  check("'undo karo' (Hindi) works the same", (await huNote()) === "", await huNote());
  await page.evaluate(() => scrollTo(0, 0));
  await say("scroll down");
  const huScrolled = await page.evaluate(() => scrollY);
  await say("undo");
  check("'undo' scrolls back to where you were", huScrolled > 100 && (await page.evaluate(() => scrollY)) < 5, `${huScrolled} -> ${await page.evaluate(() => scrollY)}`);

  // undo is honest about what it can't reverse
  await say("click add to cart");
  const huCart = await text("#cart-count");
  await say("undo");
  check("'undo' after Add to cart says it can't, and changes nothing", /can't undo/i.test(await status()) && (await text("#cart-count")) === huCart, `${await status()} cart ${huCart} -> ${await text("#cart-count")}`);

  // undo closes a page that a click opened in a new tab
  await page.evaluate(() => document.getElementById("newtab").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const huTabsBefore = ctx.pages().length;
  const huOpened = ctx.waitForEvent("page", { timeout: 10000 });
  await say("click open the grocery page in a new tab");
  const huNew = await huOpened;
  check("setup: the click opened a new tab", ctx.pages().length === huTabsBefore + 1);
  const closing = huNew.waitForEvent("close", { timeout: 8000 }).then(() => true).catch(() => false);
  await say("undo");
  check("'undo' closes the tab that the click opened", await closing && ctx.pages().length === huTabsBefore, `pages ${huTabsBefore} -> ${ctx.pages().length}; ${await status()}`);

  // ---- found by the independent review: undo in the tab that has the focus, site-native Undo, forms, stale switches, the card ----
  await page.goto(`${BASE}/shop.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  const rvTab = async (opts) => {
    await page.evaluate(() => document.getElementById("newtab").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const before = ctx.pages().length;
    const opened = ctx.waitForEvent("page", { timeout: 10000 });
    await say("click open the grocery page in a new tab");
    const tab = await opened;
    await tab.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await tab.waitForTimeout(700);
    return { tab, before };
  };
  // 1. the new tab has the focus after the click, so "undo" is spoken THERE
  {
    const { tab, before } = await rvTab();
    const closing = tab.waitForEvent("close", { timeout: 8000 }).then(() => true).catch(() => false);
    await tab.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: "undo" })));
    check("'undo' said in the new tab itself closes it and returns to the page you came from", (await closing) && ctx.pages().length === before, `tabs ${before} -> ${ctx.pages().length}`);
  }
  // 2. a tab you open yourself, soon after a voice click, is not something "undo" may close
  {
    await page.evaluate(() => document.getElementById("newtab").scrollIntoView({ block: "center" }));
    await say("click bottom link");
    const mine = await ctx.newPage(); // as if you pressed Ctrl+T
    await mine.goto("about:blank");
    await mine.waitForTimeout(500);
    const tabs = ctx.pages().length;
    await page.bringToFront();
    await say("undo");
    await page.waitForTimeout(800);
    check("'undo' never closes a tab you opened yourself", ctx.pages().length === tabs, `tabs ${tabs} -> ${ctx.pages().length}`);
    await mine.close();
  }
  // 3. a site's own Undo button is pressed instead of guessing
  await page.goto(`${BASE}/own-undo.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  await say("click archive");
  await say("undo");
  check("'undo' presses the page's own Undo button when it has one", (await text("#log")) === "restored by the page", `${await text("#log")} said: ${await status()}`);
  // 4. a form that sends data cannot be undone, and we say so
  await page.goto(`${BASE}/post-form.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  await say("click continue");
  await say("undo");
  check("'undo' after a form submit says it can't, instead of claiming nothing happened", /can't undo/i.test(await status()) && (await text("#log")) === "sent", `${await status()} | ${await text("#log")}`);
  // 5. a switch that the page changed since: undo must not flip the wrong way
  await say("click flip back");
  await page.waitForTimeout(900);
  const flipBefore = await page.evaluate(() => document.getElementById("flip").checked);
  await say("undo");
  check("'undo' leaves a switch alone when the page has already changed it", /changed since|didn't change|nothing to undo/i.test(await status()) && flipBefore === (await page.evaluate(() => document.getElementById("flip").checked)), `${await status()} checked ${flipBefore}`);
  await say("click plain switch");
  check("setup: the plain switch is on", await page.evaluate(() => document.getElementById("plain").checked));
  await page.waitForTimeout(500);
  await say("undo");
  check("'undo' still switches a plain switch back", !(await page.evaluate(() => document.getElementById("plain").checked)), await status());

  // 6. the help card must not hide the page from VoiceNav's own scan, and Escape puts it away
  await page.goto(`${BASE}/results.html`);
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
  await page.evaluate(() => scrollTo(0, 0));
  await say("read the results");
  check("setup: the card is showing", !(await huCard()).hidden);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("voicenav-dump", { detail: "product" })));
  const underCard = await page.evaluate(() => JSON.parse(document.querySelector("#voicenav-host").dataset.dump || "[]").length);
  check("page links under the card are still seen by VoiceNav", underCard >= 2, `dump found ${underCard}`); // two result titles fit on screen; with the old code the card hid them all
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Escape hides the card", (await huCard()).hidden);
  await say("what can I say");
  await say("click free delivery");
  check("a new command puts the card away and works", (await huCard()).hidden && (await text("#filter")) === "free delivery", `${await text("#filter")} hidden=${(await huCard()).hidden}`);
} catch (e) {
  if (!/extension not loaded/.test(e.message)) { check("test run completed", false, e.message); }
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
