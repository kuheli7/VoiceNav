// Real public test forms: fill and tick by voice command (typed through the test hook, no microphone), read the real DOM back.
// Safety: throwaway browser profile, no login, and every request other than GET/HEAD is aborted, so a form can't be sent even
// by accident. No command here presses a Submit button; the script also fails if any form fires a submit event.
//   node tests/live-forms.mjs
//   Sites: selenium.dev's official web-form test page, httpbin.org's pizza-order test form.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-liveforms-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) { // an unused port: these checks must not need the AI
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", "127.0.0.1:8999"));
}

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-liveforms-prof-")), {
  headless: false, viewport: { width: 1280, height: 900 }, locale: "en-IN",
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const blockedPosts = [];
await ctx.route("**/*", (route) => {
  const m = route.request().method();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
  blockedPosts.push(`${m} ${route.request().url()}`);
  return route.abort();
});
await ctx.addInitScript(() => { addEventListener("submit", () => { window.__submitFired = true; }, true); });

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };
const page = await ctx.newPage();
const say = async (cmd) => {
  const before = (await page.evaluate(() => +(document.querySelector("#voicenav-host")?.dataset.handled || 0)).catch(() => 0)) || 0;
  await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
  await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 30000 });
};
const status = () => page.evaluate(() => document.querySelector("#voicenav-host")?.shadowRoot.getElementById("status").textContent);
const card = () => page.evaluate(() => { const c = document.querySelector("#voicenav-host")?.shadowRoot.getElementById("card"); return c && !c.hidden ? c.textContent : ""; });
const val = (sel) => page.evaluate((s) => document.querySelector(s)?.value, sel);
const on = (sel) => page.evaluate((s) => document.querySelector(s)?.checked, sel);
const load = async (url) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 20000 });
  await page.waitForTimeout(800);
};

try {
  // ---------------------------------------------------------------- httpbin pizza form
  let up = true;
  try { await load("https://httpbin.org/forms/post"); } catch (e) { up = false; console.log("SKIP  httpbin.org:", e.message.split("\n")[0]); }
  if (up) {
    await say("list fields");
    const c = await card();
    check("httpbin: 'list fields' names the form's fields", /Customer name/i.test(c) && /Telephone/i.test(c) && /E-?mail/i.test(c), c.slice(0, 300));
    await say("close");
    await say("fill customer name with Asha Sharma");
    check("httpbin: fill by label", (await val("input[name=custname]")) === "Asha Sharma", `${await val("input[name=custname]")} | ${await status()}`);
    await say("fill telephone with nine eight seven six five four three two one zero");
    check("httpbin: spoken digits into the telephone box", (await val("input[name=custtel]")) === "9876543210", `${await val("input[name=custtel]")} | ${await status()}`);
    await say("fill email with asha at gmail dot com");
    check("httpbin: spoken email into 'E-mail address'", (await val("input[name=custemail]")) === "asha@gmail.com", `${await val("input[name=custemail]")} | ${await status()}`);
    await say("tick medium");
    check("httpbin: a radio button by its label", await on("input[name=size][value=medium]"), await status());
    await say("tick large");
    check("httpbin: ...switches the group", (await on("input[name=size][value=large]")) && !(await on("input[name=size][value=medium]")), await status());
    await say("tick bacon");
    await say("tick onion");
    check("httpbin: two checkboxes", (await on("input[value=bacon]")) && (await on("input[value=onion]")), await status());
    await say("untick bacon");
    check("httpbin: untick", !(await on("input[value=bacon]")) && (await on("input[value=onion]")), await status());
    await say("undo");
    check("httpbin: undo of that untick ticks bacon again", await on("input[value=bacon]"), await status());
    await say("fill delivery instructions with leave it at the door");
    check("httpbin: a textarea by its label", (await val("textarea[name=comments]")) === "leave it at the door", `${await val("textarea[name=comments]")} | ${await status()}`);
    await page.evaluate(() => document.querySelector("textarea[name=comments]").focus());
    await say("start dictation");
    await say("please ring the bell comma twice period");
    check("httpbin: dictation appends with punctuation (no capital: the sentence before had no full stop)", (await val("textarea[name=comments]")) === "leave it at the door please ring the bell, twice.", JSON.stringify(await val("textarea[name=comments]")));
    await say("delete last word");
    await say("stop dictation");
    check("httpbin: 'delete last word' then stop", (await val("textarea[name=comments]")) === "leave it at the door please ring the bell,", JSON.stringify(await val("textarea[name=comments]")));
    await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => document.querySelector("input[name=custname]").focus());
    await say("next field");
    check("httpbin: 'next field' moves to the telephone box", (await page.evaluate(() => document.activeElement.name)) === "custtel", await page.evaluate(() => document.activeElement.name));
    await say("read this field");
    check("httpbin: 'read this field' tells you what is in it", /9876543210/.test(await status()), await status());
  }

  // ---------------------------------------------------------------- selenium.dev web form
  up = true;
  try { await load("https://www.selenium.dev/selenium/web/web-form.html"); } catch (e) { up = false; console.log("SKIP  selenium.dev:", e.message.split("\n")[0]); }
  if (up) {
    await say("fill text input with hello there");
    check("selenium: text input", (await val("#my-text-id")) === "hello there", `${await val("#my-text-id")} | ${await status()}`);
    await say("fill password with open sesame");
    check("selenium: password filled, but never shown or read out", (await val("input[name=my-password]")) === "open sesame" && !/sesame/i.test(await status()), await status());
    await say("read this field");
    check("selenium: ...reading it back doesn't reveal it", !/sesame/i.test(await status()), await status());
    await say("list fields");
    check("selenium: the list never shows the password either", !/sesame/i.test(await card()), (await card()).slice(0, 200));
    await say("close");
    await say("fill textarea with some notes");
    check("selenium: textarea", (await val("textarea[name=my-textarea]")) === "some notes", await val("textarea[name=my-textarea]"));
    await say("fill dropdown with two");
    check("selenium: 'dropdown' is both a select and a datalist box, so it asks instead of guessing", /more than one/i.test(await status()), await status());
    await say("fill dropdown select with two");
    check("selenium: dropdown option by name", (await page.evaluate(() => document.querySelector("select[name=my-select]").selectedOptions[0].text)) === "Two", await status());
    await say("fill disabled input with nope");
    check("selenium: a disabled field is not filled", (await val("input[name=my-disabled]")) === "" && /no field/i.test(await status()), `${await val("input[name=my-disabled]")} | ${await status()}`);
    await say("tick default checkbox");
    check("selenium: a checkbox", await on("#my-check-2"), await status());
    await say("untick checked checkbox");
    check("selenium: untick the one that was already ticked", !(await on("#my-check-1")), await status());
    await say("tick default radio");
    check("selenium: a radio button", await on("#my-radio-2"), await status());
  }

  check("no form on any page fired a submit event", !(await page.evaluate(() => window.__submitFired === true)), "a submit event fired");
  check("nothing was sent: no POST (or other non-GET) request was even attempted", blockedPosts.length === 0, blockedPosts.join(", "));
} catch (e) {
  check("test run completed", false, e.stack || e.message);
} finally {
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
