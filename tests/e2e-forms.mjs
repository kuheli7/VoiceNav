// End-to-end test for typing and forms: loads the real extension into Chromium and "speaks" commands (typed, no microphone) at a
// local test form (fixtures/signup.html). No backend is needed: every command here must work locally.
//   node tests/e2e-forms.mjs
// The form's Submit button must never be pressed by any of these commands: the test fails if it was.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FORMS_PORT || 4175);
const BASE = `http://127.0.0.1:${PORT}`;

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-forms-ext-"));
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
  const name = path.basename(new URL(req.url, BASE).pathname) || "signup.html";
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

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-forms-prof-")), {
  headless: false,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

try {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  let submitsBefore = 0;
  const open = async () => {
    submitsBefore += await page.evaluate(() => window.__submits || 0).catch(() => 0);
    await page.goto(`${BASE}/signup.html`);
    await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(300);
  };
  const shadow = (id) => page.evaluate((i) => document.querySelector("#voicenav-host").shadowRoot.getElementById(i), id);
  const status = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
  const cardText = () => page.evaluate(() => { const c = document.querySelector("#voicenav-host").shadowRoot.getElementById("card"); return c.hidden ? "" : c.textContent; });
  const chipShown = () => page.evaluate(() => !document.querySelector("#voicenav-host").shadowRoot.getElementById("dict").hidden);
  const val = (sel) => page.evaluate((s) => document.querySelector(s).value, sel);
  const checked = (sel) => page.evaluate((s) => document.querySelector(s).checked, sel);
  const notes = () => page.evaluate(() => document.getElementById("notes").innerText.replace(/\n$/, ""));
  const focusedId = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const submits = () => page.evaluate(() => window.__submits || 0);
  const say = async (cmd, timeout = 15000) => {
    const before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0));
    await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
    await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout });
  };
  const focus = (sel) => page.evaluate((s) => document.querySelector(s).focus(), sel);

  await open();

  // ---------------- filling a field by its name
  await say("fill first name with Asha");
  check("fill by label keeps the case you said", (await val("#fn")) === "Asha", `fn="${await val("#fn")}" status="${await status()}"`);
  await say("fill last name with Sharma");
  check("fill last name", (await val("#ln")) === "Sharma", await val("#ln"));
  await say("fill name with Zed");
  check("'name' matches both first and last name: asks which, changes neither", /more than one/i.test(await status()) && (await val("#fn")) === "Asha" && (await val("#ln")) === "Sharma", await status());
  await say("type Rao in last name");
  check("'type X in last name' fills that field", (await val("#ln")) === "Rao", await val("#ln"));
  await say("type hello world");
  check("plain 'type' still types into the focused box", (await val("#ln")) === "hello world", `${await val("#ln")} focus=${await focusedId()}`);
  await say("undo");
  check("undo puts the earlier text back", (await val("#ln")) === "Rao", await val("#ln"));
  await say("clear last name");
  check("'clear last name' empties it", (await val("#ln")) === "", await val("#ln"));
  await say("undo");
  check("undo of a clear restores it", (await val("#ln")) === "Rao", await val("#ln"));

  // ---------------- email, phone, dates
  await say("fill email with asha dot sharma at gmail dot com");
  check("spoken email becomes an address", (await val("#em")) === "asha.sharma@gmail.com", `${await val("#em")} ${await status()}`);
  check("...and 'Confirm email' was not touched", (await val("#em2")) === "", await val("#em2"));
  await say("fill confirm email with asha at gmail dot com");
  check("'confirm email' is its own field", (await val("#em2")) === "asha@gmail.com" && (await val("#em")) === "asha.sharma@gmail.com", `${await val("#em2")}`);
  await say("fill email with not an email");
  check("a bad email is refused, the old value stays", /email/i.test(await status()) && (await val("#em")) === "asha.sharma@gmail.com", await status());
  await say("fill phone with nine eight seven six five four three two one zero");
  check("spoken digits become a number", (await val("#ph")) === "9876543210", `${await val("#ph")} ${await status()}`);
  await say("fill mobile with 98765 43211");
  check("'mobile' is the phone field, spaces dropped", (await val("#ph")) === "9876543211", await val("#ph"));
  await say("fill phone with call me");
  check("words that aren't digits are refused", /number/i.test(await status()) && (await val("#ph")) === "9876543211", await status());
  await say("fill date of birth with 5th of March 1999");
  check("a date goes into a date input as 1999-03-05", (await val("#dob")) === "1999-03-05", `${await val("#dob")} ${await status()}`);
  await say("fill date of birth with 31 february 2023");
  check("an impossible date is refused", /date/i.test(await status()) && (await val("#dob")) === "1999-03-05", await status());
  await say("fill quantity with 5");
  check("a field with only a placeholder is found by it", (await val("#qty")) === "5", await val("#qty"));
  await say("put 7 in quantity");
  check("'put 7 in quantity'", (await val("#qty")) === "7", await val("#qty"));
  await say("put 7 in nothing at all");
  check("'put X in Y' with no such field types nothing anywhere (it goes to the AI, which is off here)", (await val("#qty")) === "7" && (await val("#fn")) === "Asha" && (await val("#comments")) === "", `${await status()} qty=${await val("#qty")}`);
  await say("fill postal code with four zero zero zero zero one");
  check("a postal code is read as digits", (await val("#zip")) === "400001", await val("#zip"));
  await say("fill otp with one two three four five six");
  check("a field that cuts the text is reported, not claimed", (await val("#otp")) === "1234" && /only holds/i.test(await status()), `${await val("#otp")} ${await status()}`);

  // ---------------- dropdowns, radios, checkboxes
  await say("fill country with india");
  check("a dropdown option is chosen by name", (await val("#country")) === "IN", await val("#country"));
  await say("fill country with narnia");
  check("an option that isn't there is refused", /no option/i.test(await status()) && (await val("#country")) === "IN", await status());
  await say("undo");
  await say("fill gender with female");
  check("'fill gender with female' picks the radio button", await checked("#g-f"), await status());
  await say("tick male");
  check("'tick male' switches the group", (await checked("#g-m")) && !(await checked("#g-f")), await status());
  await say("undo");
  check("undo goes back to the earlier radio choice", (await checked("#g-f")) && !(await checked("#g-m")), await status());
  await say("untick female");
  check("a radio button can't be switched off, and says so", (await checked("#g-f")) && /radio/i.test(await status()), await status());
  await say("tick the newsletter checkbox");
  check("tick a checkbox by its words", await checked("#news"), await status());
  await say("tick newsletter");
  check("ticking twice says it is already ticked", /already/i.test(await status()) && (await checked("#news")), await status());
  await say("untick newsletter");
  check("untick", !(await checked("#news")), await status());
  await say("tick terms");
  check("a checkbox inside its label (terms and conditions)", await checked("#terms"), await status());
  await say("undo");
  check("undo of a tick unticks it", !(await checked("#terms")), await status());
  await say("tick remember me");
  check("a custom role=checkbox works too", (await page.evaluate(() => document.getElementById("remember").getAttribute("aria-checked"))) === "true", await status());
  await say("fill newsletter with yes");
  check("'fill newsletter with yes' ticks it", await checked("#news"), await status());
  await say("fill newsletter with maybe");
  check("'fill newsletter with maybe' doesn't guess", /tick/i.test(await status()) && (await checked("#news")), await status());

  // ---------------- things that must be left alone or kept private
  await say("fill website with spam");
  check("a hidden spam-trap field is never filled", (await val("#site")) === "" && /no field/i.test(await status()), `${await val("#site")} ${await status()}`);
  await say("fill password with hunter two");
  check("a password goes in", (await val("#pw")) === "hunter two", await val("#pw"));
  check("...but is never shown in the status", !/hunter/i.test(await status()), await status());
  await say("read this field");
  check("...nor read back", !/hunter/i.test(await status()) && /hidden/i.test(await status()), await status());
  await say("list fields");
  const card = await cardText();
  check("list fields shows the visible fields only, with their state", /First name/.test(card) && /Asha/.test(card) && /Country/.test(card) && !/Website/.test(card), card.slice(0, 300));
  check("...and never a password", !/hunter/i.test(card), card);
  check("...the radio group is one line, with its options", /Gender/.test(card) && /Male, Female, Other/.test(card) && (card.match(/Gender/g) || []).length === 1, card);

  // ---------------- moving through the form
  await focus("#fn");
  await say("next field");
  check("'next field' moves on", (await focusedId()) === "ln", await focusedId());
  await say("previous field");
  check("'previous field' goes back", (await focusedId()) === "fn", await focusedId());
  await say("next field");
  await say("repeat");
  check("'repeat' says the last move again", (await focusedId()) === "em", await focusedId());
  await page.evaluate(() => document.activeElement.blur());
  await say("next field");
  check("after clicking away, 'next field' carries on from the last field you were in", (await focusedId()) === "em2", await focusedId());
  await focus("#notes");
  await say("next field");
  check("'next field' skips all the hidden spam-trap fields (next visible one is Sex)", (await focusedId()) === "sex", await focusedId());
  await focus("#fn");
  await say("previous field");
  check("'previous field' on the first field says so", /first field/i.test(await status()) && (await focusedId()) === "fn", await status());

  // ---------------- typing special things into the box you are in
  await focus("#em");
  await say("type email priya underscore k at outlook dot com");
  check("'type email ...' into the focused box", (await val("#em")) === "priya_k@outlook.com", `${await val("#em")} ${await status()}`);
  await focus("#ph");
  await say("type number double nine double eight seven");
  check("'type number ...' into the focused box", (await val("#ph")) === "99887", await val("#ph"));
  await focus("#zip");
  await say("type date 1 jan 2000");
  check("'type date' into a plain text box writes DD/MM/YYYY", (await val("#zip")) === "01/01/2000", await val("#zip"));
  await focus("#dob");
  await say("type date 2 march 2001");
  check("'type date' into a date input writes the ISO form", (await val("#dob")) === "2001-03-02", await val("#dob"));

  // ---------------- dictation
  await focus("#comments");
  await say("start dictation");
  check("dictation shows a Dictating chip", await chipShown(), await status());
  await say("hello comma how are you question mark");
  check("spoken punctuation and a capital", (await val("#comments")) === "Hello, how are you?", await val("#comments"));
  await say("i am fine period");
  check("sentences join with a space and a capital", (await val("#comments")) === "Hello, how are you? I am fine.", await val("#comments"));
  await say("click submit");
  check("in dictation, 'click submit' is typed, not obeyed", (await val("#comments")).endsWith("Click submit") && (await submits()) === 0, `${await val("#comments")} submits=${await submits()}`);
  await say("undo");
  check("undo removes the last thing dictated", (await val("#comments")) === "Hello, how are you? I am fine.", await val("#comments"));
  await say("delete last word");
  check("'delete last word'", (await val("#comments")) === "Hello, how are you? I am", await val("#comments"));
  await say("new line");
  await say("second line here");
  check("'new line' starts a line", (await val("#comments")) === "Hello, how are you? I am\nSecond line here", JSON.stringify(await val("#comments")));
  await say("delete that");
  check("'delete that' removes the last phrase", (await val("#comments")) === "Hello, how are you? I am\n", JSON.stringify(await val("#comments")));
  await say("नमस्ते कॉमा आप कैसे हैं प्रश्न चिह्न");
  check("Hindi dictation is typed as spoken, with the punctuation words", (await val("#comments")).endsWith("नमस्ते, आप कैसे हैं?"), await val("#comments"));
  await say("stop dictation");
  check("'stop dictation' hides the chip", !(await chipShown()), await status());
  await say("scroll down");
  await page.waitForTimeout(400);
  check("after dictation, commands work again (scroll moved the page, nothing typed)", (await page.evaluate(() => scrollY)) > 0 && !(await val("#comments")).includes("croll"), `scrollY=${await page.evaluate(() => scrollY)}`);

  // ---------------- rich text box
  await open();
  await focus("#notes");
  await say("start dictation");
  await say("meeting at five period");
  check("dictation into a rich (contenteditable) box", (await notes()) === "Meeting at five.", JSON.stringify(await notes()));
  await say("stop dictation");
  await say("fill notes with buy milk");
  check("fill a rich box by its label", (await notes()) === "buy milk", JSON.stringify(await notes()));
  await say("undo");
  check("undo works there too", (await notes()) === "Meeting at five.", JSON.stringify(await notes()));

  // ---------------- ordinary typing keeps its meaning
  await focus("#comments");
  await say("type i live in delhi");
  check("'type i live in delhi' is typed whole (there is no field called delhi)", (await val("#comments")) === "i live in delhi", await val("#comments"));
  await focus("#fn");
  await say("type hello in the box");
  check("'type hello in the box' types into the box you are in", (await val("#fn")) === "hello", await val("#fn"));
  await say("clear the text");
  check("'clear the text' still clears the focused box", (await val("#fn")) === "", await val("#fn"));

  // ---------------- found by the independent review
  await open();
  await say("list fields");
  const reviewCard = await cardText();
  check("a field inside a transparent parent, and one parked above the page, are not listed", !/Company website|Fax/.test(reviewCard) && /Sex/.test(reviewCard), reviewCard.slice(0, 250));
  await say("close");
  await say("fill company website with spam");
  check("...and cannot be filled", (await val("#trap2")) === "" && /no field/i.test(await status()), await status());
  await say("fill sex with female please");
  check("a dropdown never picks its empty '--' placeholder", (await page.evaluate(() => document.getElementById("sex").selectedOptions[0].text)) === "Female", await status());
  await focus("#comments");
  await say("start dictation");
  await say("first part");
  await focus("#country");
  await say("second part");
  check("dictation stays in its box when focus moves to a dropdown", (await val("#comments")) === "First part second part" && (await val("#ph")) === "", `${JSON.stringify(await val("#comments"))}`);
  await say("go");
  await say("enter");
  check("in dictation, 'go' and 'enter' are words, and never submit the form", (await submits()) === 0, `submits=${await submits()} text=${JSON.stringify(await val("#comments"))}`);
  check("...they are typed as text", /go enter$/i.test(await val("#comments")), JSON.stringify(await val("#comments")));
  await say("stop dictation");
  await say("delete last word");
  await say("delete that");
  check("'delete that' after a delete does not bring the text back", !/enter$/i.test(await val("#comments")), JSON.stringify(await val("#comments")));
  await focus("#pw");
  await say("start dictation");
  await say("secret pass 99");
  check("dictation into a password box types it exactly as said", (await val("#pw")) === "secret pass 99", await val("#pw"));
  const heardLine = await page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("heard").textContent);
  check("...and the 'Heard' line hides it", !/secret/i.test(heardLine) && !/secret/i.test(await status()), heardLine);
  await say("stop dictation");
  await focus("#comments");
  await say("write email to my boss asking for leave");
  check("'write email to my boss...' is a sentence, so it is typed", /email to my boss asking for leave$/.test(await val("#comments")), JSON.stringify(await val("#comments")));
  await page.evaluate(() => document.activeElement.blur());
  await say("delete this");
  check("'delete this' with no text box focused does not wipe a box", /email to my boss/.test(await val("#comments")), await val("#comments"));

  // ---------------- the end
  await open();
  await say("fill first name with Test");
  await say("start dictation");
  await say("close the page");
  check("dictation only ever types: 'close the page' did not leave the page", (await page.url()).includes("signup.html"), page.url());
  await say("stop dictation");
  check("nothing in this run pressed the form's Submit button", submitsBefore + (await submits()) === 0, `submits=${submitsBefore + (await submits())}`);
} catch (e) {
  check("test run completed", false, e.stack || e.message);
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
