// End-to-end test for: the voice log, tabs and other sites, chained commands, video controls, scrolling a named part of the page,
// the search icon, icon-only buttons, mail-style lists. Loads the real extension into Chromium; commands are typed through the test
// hook (no microphone). The pages are MOCKS of ChatGPT's and Gmail's layout (see the comments in each fixture). Two checks open
// example.com (a plain public page, read-only) to prove that another site can be opened and switched to.
//   node tests/e2e-browse.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BROWSE_PORT || 4176);
const BASE = `http://127.0.0.1:${PORT}`;

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-browse-ext-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
const src = fs.readFileSync(cs, "utf8");
if (!src.includes("const TEST_HOOK = false;")) throw new Error("TEST_HOOK flag not found in content.js");
fs.writeFileSync(cs, src.replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) { // an unused port: nothing here may need the AI (and never touch the real backend)
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", "127.0.0.1:8999"));
}

const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, BASE).pathname) || "chatui.html";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-browse-prof-")), {
  headless: false,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  const sayOn = async (pg, cmd, timeout = 20000) => {
    const before = await pg.evaluate(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0));
    await pg.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await pg.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
  };
  const say = (cmd, timeout) => sayOn(page, cmd, timeout);
  const statusOf = (pg) => pg.evaluate(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent);
  const status = () => statusOf(page);
  const cardText = (pg = page) => pg.evaluate(() => { const c = document.querySelector("#voicenav-host")?.shadowRoot.getElementById("card"); return c && !c.hidden ? c.textContent : ""; });
  const open = async (name) => {
    await page.goto(`${BASE}/${name}`);
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(400);
  };
  const sw = async () => ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 10000 }));
  const activeUrl = async () => (await sw()).evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);
  const waitForHost = (pg) => pg.waitForSelector("#voicenav-host", { state: "attached", timeout: 15000 });

  // ================================================================ ChatGPT-style page
  await open("chatui.html");
  const threadTop = () => page.evaluate(() => document.getElementById("thread").scrollTop);
  const sideTop = () => page.evaluate(() => document.getElementById("side").scrollTop);
  const clicks = () => page.evaluate(() => window.__clicks.slice());
  const sent = () => page.evaluate(() => window.__sent.slice());

  await say("scroll up");
  const up1 = await threadTop();
  check("a chat that scrolls upside-down (column-reverse) CAN scroll up", up1 < -50, `scrollTop=${up1}`);
  await say("scroll up");
  check("...and again", (await threadTop()) < up1, `scrollTop=${await threadTop()}`);
  await say("scroll down");
  check("...and down again", (await threadTop()) > (await threadTop()) - 1 && (await threadTop()) > up1 - 1 - 1000, `${await threadTop()}`);
  await say("scroll down a lot");
  await say("scroll down a lot");
  check("...back to the newest message", (await threadTop()) === 0, `scrollTop=${await threadTop()}`);

  const t0 = await threadTop();
  await say("scroll down the recent chats");
  check("'scroll down the recent chats' moves the left list, not the chat", (await sideTop()) > 50 && (await threadTop()) === t0, `side=${await sideTop()} thread=${await threadTop()}`);
  const s1 = await sideTop();
  await say("scroll down in the sidebar");
  check("...'in the sidebar' too", (await sideTop()) > s1, `${await sideTop()}`);
  await say("scroll up the left side");
  await say("scroll up the left side");
  check("...and back up", (await sideTop()) < s1, `${await sideTop()}`);
  await say("scroll up the right side");
  check("a side that doesn't exist says so, and moves nothing", /nothing to scroll|can't/i.test(await status()) && (await threadTop()) === t0, await status());

  await say("click the plus icon");
  check("'the plus icon' finds the icon-only 'Add files and more' button", (await clicks()).includes("plus"), `${await status()} clicks=${await clicks()}`);
  await say("click the mouse");
  check("'the mouse' (heard for mic) finds the Dictate button", (await clicks()).includes("mic"), `${await status()}`);
  await say("click the microphone");
  await page.waitForTimeout(800); // asking for the same button again presses it for real, which lands a moment after the command ends
  check("'the microphone' too", (await clicks()).filter((c) => c === "mic").length === 2, `${await clicks()}`);

  await say("search");
  check("'search' alone presses the search icon and puts the cursor in the box", await page.evaluate(() => document.activeElement.id === "q"), `${await status()} active=${await page.evaluate(() => document.activeElement.id)}`);
  await say("python tutorials");
  check("what you say next is typed in the search box, not the chat box", (await page.evaluate(() => document.getElementById("q").value)) === "python tutorials" && (await page.evaluate(() => document.getElementById("prompt-textarea").innerText.trim())) === "", await status());
  await page.keyboard.press("Escape");
  await say("search chats");
  await page.waitForTimeout(300);
  check("'search chats' works the same way", await page.evaluate(() => document.activeElement.id === "q"), await status());
  await page.keyboard.press("Escape");

  await say("open python loops");
  const cl = await clicks();
  check("'open python loops' opens THAT chat, not 'Python loops vs recursion'", cl[cl.length - 1] === "chat:Python loops", `last=${cl[cl.length - 1]}`);
  await say("open the chat about recipe ideas");
  const cl2 = await clicks();
  check("'open the chat about recipe ideas' (filler words) finds 'Recipe ideas'", cl2[cl2.length - 1] === "chat:Recipe ideas", `last=${cl2[cl2.length - 1]} ${await status()}`);

  await say("open alpha project and then chat");
  await page.waitForTimeout(400);
  check("'open the project and then chat' does both: the new 'chat' button that appeared, not a chat in the list", (await clicks()).includes("projchat"), `${await status()} clicks=${(await clicks()).slice(-3)}`);

  await page.evaluate(() => document.activeElement.blur());
  for (let i = 1; i <= 4; i++) {
    await say(`type message number ${i}`);
    await say("send");
  }
  check("four messages typed and sent, all four arrive", JSON.stringify(await sent()) === JSON.stringify([1, 2, 3, 4].map((i) => `message number ${i}`)), JSON.stringify(await sent()));

  await say("click the flurble gizmo");
  check("something it can't do says so", /ai|not sure|couldn't|can't/i.test(await status()), await status());

  // ---------------- the log
  const extId = new URL((await sw()).url()).host;
  const logPage = await ctx.newPage();
  await logPage.goto(`chrome-extension://${extId}/options.html`);
  await logPage.waitForSelector("#stats .stat", { timeout: 10000 });
  await logPage.waitForTimeout(500);
  const statsText = await logPage.evaluate(() => document.getElementById("stats").textContent);
  check("the log page shows what worked and what didn't", /Worked/.test(statsText) && /Didn't work/.test(statsText), statsText);
  const failedRows = await logPage.evaluate(() => document.getElementById("list").textContent);
  check("the failed command is in the log with the site", /flurble/i.test(failedRows) && /127\.0\.0\.1/.test(failedRows), failedRows.slice(0, 300));
  await logPage.click("#f-ok");
  const okRows = await logPage.evaluate(() => document.getElementById("list").textContent);
  check("the commands that worked are listed too", /scroll/i.test(okRows) && /plus icon/i.test(okRows), okRows.slice(0, 300));
  check("what was typed is NOT stored, only that something was", !/message number/.test(okRows) && /not stored/.test(okRows), okRows.slice(0, 400));
  await logPage.close();

  // ================================================================ Gmail-style list
  await open("mail.html");
  const opened = () => page.evaluate(() => window.__opened.slice());
  const selected = () => page.evaluate(() => document.querySelectorAll(".cb[aria-checked=true]").length);
  await say("open the email from Rahul");
  check("'open the email from Rahul' OPENS it (and does not tick it)", JSON.stringify(await opened()) === JSON.stringify(["Lunch tomorrow?"]) && (await selected()) === 0, `${await opened()} sel=${await selected()} ${await status()}`);
  await say("close the email");
  check("'close the email' goes back to the inbox", await page.evaluate(() => !document.getElementById("list").hidden), await status());
  await say("open the email from Priya");
  check("two emails from Priya: it asks which, and opens neither", (await opened()).length === 1 && /matches/i.test(await status()), `${await opened()} ${await status()}`);
  await page.evaluate(() => document.querySelectorAll(".cb")[0].click());
  await page.evaluate(() => document.querySelectorAll(".cb")[2].click());
  check("setup: two emails are selected", (await selected()) === 2, `${await selected()}`);
  await say("deselect all");
  check("'deselect all' unticks them", (await selected()) === 0, `${await selected()} ${await status()}`);
  await say("select all emails");
  check("'select all emails' ticks the master box", (await selected()) === 6, `${await selected()} ${await status()}`);
  await say("unselect all");
  check("'unselect all' clears it", (await selected()) === 0, `${await selected()}`);
  await say("deselect all");
  check("nothing selected: says so", /nothing is selected/i.test(await status()), await status());

  // ================================================================ video
  await open("video.html");
  const media = (f) => page.evaluate(`(() => { const v = document.getElementById("v"); return ${f}; })()`);
  await say("play");
  await page.waitForTimeout(500);
  check("setup: the video plays", await media("!v.paused"), await status());
  await say("speed 1.5");
  check("'speed 1.5' sets the playback speed", (await media("v.playbackRate")) === 1.5, `${await media("v.playbackRate")}`);
  await say("make the video faster");
  check("'make the video faster' steps it up", (await media("v.playbackRate")) === 1.75, `${await media("v.playbackRate")}`);
  await say("faster");
  check("a bare 'faster' while a video plays (no scrolling) speeds the video", (await media("v.playbackRate")) === 2, `${await media("v.playbackRate")}`);
  await say("slow down the video");
  check("'slow down the video'", (await media("v.playbackRate")) === 1.75, `${await media("v.playbackRate")}`);
  await say("normal speed");
  check("'normal speed'", (await media("v.playbackRate")) === 1, `${await media("v.playbackRate")}`);
  await say("go to 30 seconds");
  check("'go to 30 seconds'", Math.abs((await media("v.currentTime")) - 30) < 2, `${await media("v.currentTime")}`);
  await say("skip 10 seconds");
  check("'skip 10 seconds'", Math.abs((await media("v.currentTime")) - 40) < 2.5, `${await media("v.currentTime")}`);
  await say("rewind 15 seconds");
  check("'rewind 15 seconds'", Math.abs((await media("v.currentTime")) - 25) < 2.5, `${await media("v.currentTime")}`);
  await say("repeat");
  check("'repeat' skips back again", Math.abs((await media("v.currentTime")) - 10) < 3, `${await media("v.currentTime")}`);
  await say("restart");
  check("'restart'", (await media("v.currentTime")) < 2, `${await media("v.currentTime")}`);
  await say("like the video");
  check("'like the video' presses the like button", (await page.evaluate(() => document.getElementById("likebtn").getAttribute("aria-pressed"))) === "true", await status());
  await say("like");
  check("liking twice says it is already liked", /already/i.test(await status()), await status());
  await say("dislike");
  check("'dislike'", (await page.evaluate(() => document.getElementById("dislikebtn").getAttribute("aria-pressed"))) === "true", await status());
  await say("speed 20");
  check("an absurd speed isn't taken for a command", (await media("v.playbackRate")) === 1, `${await media("v.playbackRate")} ${await status()}`);

  // ================================================================ found by the independent review
  await open("review2.html");
  const clicks2 = () => page.evaluate(() => window.__clicks.slice());
  await say("type hello there");
  await say("send");
  await page.waitForTimeout(2200);
  check("a chat that clears its box slowly gets the message ONCE, not twice", JSON.stringify(await page.evaluate(() => window.__sent)) === JSON.stringify(["hello there"]), JSON.stringify(await page.evaluate(() => window.__sent)));
  await say("go to inbox");
  check("'go to inbox' presses the Inbox link (it does not go back a page)", (await clicks2()).includes("inbox") && /review2\.html/.test(page.url()), `${await clicks2()} ${page.url()}`);
  await say("open docs");
  check("'open docs' presses the page's own Docs link before leaving for another site", (await clicks2()).includes("docs") && /review2\.html/.test(page.url()), `${await clicks2()} ${page.url()}`);
  await say("close the message");
  check("'close the message' closes the open popup, and stays on the page", (await clicks2()).includes("close") && /review2\.html/.test(page.url()), `${await clicks2()} ${page.url()}`);
  await say("clear all");
  check("'clear all' presses the page's Clear all button", (await clicks2()).includes("clearall"), `${await clicks2()} ${await status()}`);
  check("...and does not untick the checkboxes in the form", await page.evaluate(() => document.getElementById("keep").checked), "the form's box was unticked");
  await say("search");
  await say("click images");
  check("after 'search', a real command like 'click images' still runs (it is not typed as a query)", (await clicks2()).includes("images") && (await page.evaluate(() => document.getElementById("q").value)) === "", `${await clicks2()} q=${await page.evaluate(() => document.getElementById("q").value)}`);
  await say("search");
  await say("my private query");
  await say("switch to the fifth tab");
  const extId2 = new URL((await sw()).url()).host;
  const lp = await ctx.newPage();
  await lp.goto(`chrome-extension://${extId2}/options.html`);
  await lp.waitForSelector("#stats .stat", { timeout: 10000 });
  await lp.waitForTimeout(500);
  await lp.click("#f-all");
  const all2 = await lp.evaluate(() => document.getElementById("list").textContent);
  check("what you searched for is not in the log", !/private query/i.test(all2), all2.slice(0, 300));
  await lp.click("#f-failed");
  const bad2 = await lp.evaluate(() => document.getElementById("list").textContent);
  check("'There is no tab 5' is logged as a failure", /fifth tab|index/i.test(bad2) && /no tab/i.test(bad2), bad2.slice(0, 300));
  await lp.close();

  // a step that opens another tab hands the rest of the sentence to it
  await open("review2.html");
  const [tabB] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), say("open report page and then compose")]);
  await tabB.waitForLoadState("domcontentloaded");
  await waitForHost(tabB).catch(() => {});
  await sleep(5500);
  check("'open report page and then compose': 'compose' ran in the NEW tab", (await tabB.evaluate(() => window.__composed)) === 1, `composed=${await tabB.evaluate(() => window.__composed)}`);
  await tabB.close();
  await page.bringToFront();

  // ================================================================ tabs and other sites
  await open("mail.html");
  const [exampleTab] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 20000 }),
    say("open example dot com in a new tab"),
  ]);
  await exampleTab.waitForLoadState("domcontentloaded").catch(() => {});
  await waitForHost(exampleTab).catch(() => {});
  check("'open example.com in a new tab' opens that site in a new tab", /example\.com/.test(exampleTab.url()) && ctx.pages().length === 3, `${exampleTab.url()} tabs=${ctx.pages().length}`);
  check("...and it became the active tab", /example\.com/.test(await activeUrl()), await activeUrl());
  await sleep(500);
  await sayOn(exampleTab, "list tabs");
  const tabCard = await cardText(exampleTab);
  check("'list tabs' lists them, with this one marked", /\(this tab\)/.test(tabCard) && /127\.0\.0\.1/.test(tabCard) && /example\.com/.test(tabCard), tabCard.slice(0, 300));
  await sayOn(exampleTab, "previous tab");
  await sleep(700);
  check("'previous tab' switches away (and the other page now has the focus)", !/example\.com/.test(await activeUrl()), await activeUrl());
  const here2 = ctx.pages().find((p) => p.url().includes("/mail.html")) || page;
  await waitForHost(here2);
  await sayOn(here2, "next tab");
  await sleep(700);
  check("'next tab' comes forward again", /example\.com/.test(await activeUrl()), await activeUrl());
  await sayOn(here2, "switch to the first tab");
  await sleep(500);
  const firstUrl = await activeUrl();
  await sayOn(ctx.pages().find((p) => p.url() === firstUrl) || here2, "switch to example.com");
  await sleep(700);
  check("'switch to example.com' goes to the tab that already has it", /example\.com/.test(await activeUrl()), await activeUrl());
  await sayOn(exampleTab, "close this tab").catch(() => {}); // the page is gone before it can answer
  await sleep(800);
  check("'close this tab' closes it", !ctx.pages().some((p) => /example\.com/.test(p.url())), ctx.pages().map((p) => p.url()).join(" | "));
  const left = ctx.pages().find((p) => p.url().includes("/mail.html"));
  if (left) { await left.bringToFront(); await waitForHost(left); await sayOn(left, "reopen closed tab"); await sleep(1500); }
  check("'reopen closed tab' brings example.com back", ctx.pages().some((p) => /example\.com/.test(p.url())), ctx.pages().map((p) => p.url()).join(" | "));

  // another page in the same tab, and the second half of a sentence carried over to the new page
  await open("mail.html");
  await say("open example dot com and then show numbers").catch(() => {}); // the page is replaced before it can answer
  await page.waitForURL(/example\.com/, { timeout: 20000 });
  await waitForHost(page);
  await page.waitForTimeout(4500);
  const badges = await page.evaluate(() => document.querySelector("#voicenav-host")?.shadowRoot.querySelectorAll(".badge").length);
  check("'open example.com and then show numbers': the second step ran on the NEW page", badges >= 1, `badges=${badges} url=${page.url()}`);
  await say("undo").catch(() => {}); // going back replaces the page
  await page.waitForTimeout(1200);
  check("'undo' goes back from the site it opened", /mail\.html/.test(page.url()), page.url());
} catch (e) {
  check("test run completed", false, e.stack || e.message);
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
