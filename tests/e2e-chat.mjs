// End-to-end test for chat sites: loads the real extension into Chromium and "speaks" commands to local MOCK pages that
// reproduce how Claude, ChatGPT and Gemini composers behave (see the comments at the top of each fixture). These are mocks,
// not the real sites: the real ones need a login.
//
//   node tests/e2e-chat.mjs          (no backend needed: every chat command must work locally, with no AI round trip)
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const SEND_BUDGET_MS = 1500; // from the command to the message being sent

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-chat-ext-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
const src = fs.readFileSync(cs, "utf8");
if (!src.includes("const TEST_HOOK = false;")) throw new Error("TEST_HOOK flag not found in content.js");
fs.writeFileSync(cs, src.replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
// Point the copy at a port nobody listens on unless BACKEND_PORT is set: chat commands must not need the AI
const port = process.env.BACKEND_PORT || "8999";
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${port}`));
}

const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, BASE).pathname) || "claude.html";
  const file = path.join(here, "fixtures", name);
  res.setHeader("Content-Type", "text/html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1");

let passed = 0, failed = 0;
const timings = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  ok ? passed++ : failed++;
}

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-chat-prof-")), {
  headless: false,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

try {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  const open = async (name) => {
    await page.goto(`${BASE}/${name}`);
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(300);
  };
  const status = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
  const heard = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("heard").textContent);
  const sent = () => page.evaluate(() => window.__sent);
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  // Returns the page clock when the command was given, so the time to send can be measured on the page itself
  const say = async (cmd, timeout = 15000) => {
    const before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0));
    const t0 = await page.evaluate((c) => { const t = performance.now(); document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })); return t; }, cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
    return t0;
  };
  // A message must arrive by the button, with the right text, within the budget, and without asking the AI
  const expectSent = async (label, t0, text, n = 1) => {
    const s = await sent();
    const at = await page.evaluate(() => window.__sentAt);
    const ms = at == null || at < t0 ? null : Math.round(at - t0); // an earlier message doesn't count
    if (ms != null) timings.push({ label, ms });
    const h = await heard();
    const last = s[s.length - 1];
    check(`${label}: sent by the send button`, s.length === n && last?.how === "button" && last?.text === text,
      `sent=${JSON.stringify(s)} status="${await status()}"`);
    check(`${label}: within ${SEND_BUDGET_MS} ms, no AI round trip`, ms != null && ms < SEND_BUDGET_MS && !/llm|resolver|Thinking/i.test(h + (await status())),
      `ms=${ms} heard="${h}" status="${await status()}"`);
  };

  // ---------------- Claude-style: ProseMirror, disabled "Send message" for 600 ms, untrusted Enter ignored
  await open("claude.html");
  await say("type What is 2 plus 2?");
  const typed = await page.evaluate(() => document.querySelector(".ProseMirror").innerText.trim());
  check("claude: 'type' writes into the composer, not the sidebar search", typed === "What is 2 plus 2?" &&
    (await page.evaluate(() => document.querySelector("nav input").value)) === "", `editor="${typed}"`);
  let t0 = await say("send");
  await expectSent("claude: 'type ...' then 'send'", t0, "What is 2 plus 2?");
  check("claude: says it was sent", /^sent/i.test(await status()), await status());

  await say("send it");
  check("claude: 'send it' with an empty box says so and sends nothing", (await sent()).length === 1 && /empty|nothing/i.test(await status()), await status());

  await say("type tell me a joke");
  t0 = await say("can you please send it");
  await expectSent("claude: 'can you please send it'", t0, "tell me a joke", 2);

  await say("type hello again");
  t0 = await say("press enter");
  await expectSent("claude: 'press enter' clicks Send (synthetic Enter is ignored by the editor)", t0, "hello again", 3);

  await open("claude.html");
  await blur();
  t0 = await say("ask what is the capital of France?");
  await expectSent("claude: 'ask ...' with nothing focused", t0, "what is the capital of France?");

  t0 = await say("type write a haiku about rain and send it");
  await expectSent("claude: 'type ... and send it'", t0, "write a haiku about rain", 2);

  await say("type one more");
  t0 = await say("press send");
  await expectSent("claude: 'press send'", t0, "one more", 3);

  await say("type and another");
  t0 = await say("submit message");
  await expectSent("claude: 'submit message'", t0, "and another", 4);

  // ---------------- ChatGPT-style: send button appears only after text; voice buttons must not be pressed
  await open("chatgpt.html");
  await say("type What is 2 plus 2?");
  t0 = await say("send");
  await expectSent("chatgpt: 'type ...' then 'send'", t0, "What is 2 plus 2?");
  t0 = await say("send what is 3 plus 3");
  await expectSent("chatgpt: 'send <text>'", t0, "what is 3 plus 3", 2);
  t0 = await say("type explain gravity simply then send");
  await expectSent("chatgpt: 'type ... then send'", t0, "explain gravity simply", 3);
  check("chatgpt: the voice and dictate buttons were never pressed", (await page.evaluate(() => document.getElementById("voice-started").textContent)) === "no",
    await page.evaluate(() => document.getElementById("voice-started").textContent));
  await say("send");
  check("chatgpt: 'send' with an empty box presses nothing", (await sent()).length === 3 &&
    (await page.evaluate(() => document.getElementById("voice-started").textContent)) === "no" && /empty|nothing/i.test(await status()), await status());

  // ---------------- Gemini-style: Quill editor watched by a MutationObserver; send button appears after typing
  await open("gemini.html");
  t0 = await say("ask Gemini what is 4 plus 4");
  await expectSent("gemini: 'ask Gemini ...'", t0, "what is 4 plus 4");
  await say("type hello gemini");
  t0 = await say("send message");
  await expectSent("gemini: 'type ...' then 'send message'", t0, "hello gemini", 2);
  check("gemini: the microphone was never pressed", (await page.evaluate(() => document.getElementById("mic-pressed").textContent)) === "no");

  // ---------------- a page with a search box AND a chat box
  await open("chat-search.html");
  await blur();
  t0 = await say("ask what are your opening hours?");
  await expectSent("search+chat: 'ask ...' uses the chat box", t0, "what are your opening hours?");
  check("search+chat: the search box was left alone", (await page.evaluate(() => document.querySelector("input[type=search]").value)) === "" && !/q=/.test(page.url()), page.url());
  await blur();
  await say("type where is my order");
  check("search+chat: 'type' with nothing focused goes to the chat box", (await page.evaluate(() => document.querySelector(".chat textarea").value)) === "where is my order" &&
    (await page.evaluate(() => document.querySelector("input[type=search]").value)) === "", await status());
  t0 = await say("send");
  await expectSent("search+chat: then 'send'", t0, "where is my order", 2);
  await Promise.all([
    page.waitForURL(/q=refunds/, { timeout: 10000 }).then(() => check("search+chat: 'search for ...' still uses the search box", true))
      .catch(() => check("search+chat: 'search for ...' still uses the search box", false, page.url())),
    say("search for refunds").catch(() => {}),
  ]);

  // ---------------- no send button at all: fall back to Enter, and report honestly whether it worked
  await open("chat-plain.html?enter=any");
  await say("type hello by enter");
  await say("send");
  check("no button, page accepts Enter: sent and reported", (await sent()).length === 1 && (await sent())[0].text === "hello by enter" && /sent/i.test(await status()), `${JSON.stringify(await sent())} "${await status()}"`);
  await open("chat-plain.html?enter=trusted");
  await say("type this will not go");
  await say("send");
  check("no button, page ignores synthetic Enter: says it couldn't send", (await sent()).length === 0 && /couldn't find a send button/i.test(await status()), await status());
  // a form whose button is "Submit order" is still a risky action: "submit" asks first
  await page.evaluate(() => document.getElementById("note").focus());
  await say("type leave at the door");
  await say("submit");
  check("'submit' on a 'Submit order' button asks for a yes", (await page.evaluate(() => document.getElementById("ordered").textContent)) === "no" && /confirm/i.test(await status()), await status());
  await say("yes");
  check("... and goes through after 'yes'", (await page.evaluate(() => document.getElementById("ordered").textContent)) === "yes", await status());

  // ---------------- search engines (Bing / DuckDuckGo markup): positions count results, not sitelinks.
  // Position commands are resolved by the backend, so this part needs BACKEND_PORT pointing at a running backend.
  const backendUp = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).then((h) => h.ok).catch(() => false);
  const vnHost = process.env.ENGINE_HOST_OVERRIDE; // e.g. "example.com" to see the behaviour without an adapter
  if (backendUp) {
    for (const engine of ["bing.com", "duckduckgo.com"]) {
      for (const [cmd, want] of [["click the second result", "w3schools"], ["open the first result", "python-org"], ["open the third result", "learnpython"]]) {
        await open(`engine.html?vn-host=${vnHost || engine}`);
        await say(cmd, 60000);
        const got = await page.evaluate(() => document.getElementById("opened").textContent);
        check(`${engine} markup: "${cmd}" opens ${want}`, got === want, `opened ${got}; said "${await status()}"`);
      }
    }
  } else console.log("SKIP  search-engine position checks (set BACKEND_PORT to a running backend)");
} catch (e) {
  check("test run completed", false, e.message);
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}

if (timings.length) {
  const ms = timings.map((t) => t.ms).sort((a, b) => a - b);
  console.log(`\ncommand-to-sent times (ms): min ${ms[0]}, median ${ms[Math.floor(ms.length / 2)]}, max ${ms[ms.length - 1]} over ${ms.length} sends`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
