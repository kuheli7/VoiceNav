// Offline speech end to end: a recording of a voice saying "scroll down" is played into a fake microphone; the extension cuts it into
// a phrase, the local backend's Whisper turns it into text, and the page must scroll. Needs the backend's Whisper installed
// (backend: pip install -r requirements-whisper.txt). Starts its own backend on port 8765.
//   node tests/e2e-whisper.mjs
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WHISPER_PAGE_PORT || 4178), BACK = Number(process.env.WHISPER_BACKEND_PORT || 8765);
const BASE = `http://127.0.0.1:${PORT}`;
const py = path.join(here, "..", "backend", ".venv", "Scripts", "python.exe");
if (!fs.existsSync(py)) { console.log("SKIP  no backend virtualenv"); process.exit(0); }

const backend = spawn(py, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BACK)], {
  cwd: path.join(here, "..", "backend"), env: { ...process.env, VOICENAV_PRELOAD_WHISPER: "1" }, stdio: "ignore",
});
const stop = () => { try { backend.kill(); } catch {} };
process.on("exit", stop);

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); ok ? passed++ : failed++; };

async function waitFor(fn, ms, step = 500) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await new Promise((r) => setTimeout(r, step)); } return null; }

const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-whisper-ext-"));
fs.cpSync(path.join(here, "..", "extension"), extDir, { recursive: true });
const cs = path.join(extDir, "content.js");
fs.writeFileSync(cs, fs.readFileSync(cs, "utf8").replace("const TEST_HOOK = false;", "const TEST_HOOK = true;"));
for (const f of ["background.js", "manifest.json"]) {
  const p = path.join(extDir, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("127.0.0.1:8000", `127.0.0.1:${BACK}`));
}
const server = http.createServer((req, res) => {
  const file = path.join(here, "fixtures", path.basename(new URL(req.url, BASE).pathname) || "long.html");
  res.setHeader("Content-Type", "text/html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1");

try {
  const up = await waitFor(async () => (await fetch(`http://127.0.0.1:${BACK}/stt`)).json(), 60000, 1000);
  if (!up) { console.log("SKIP  backend did not start"); stop(); server.close(); process.exit(0); }
  if (!up.available) { console.log("SKIP  Whisper is not installed in the backend"); stop(); server.close(); process.exit(0); }

  for (const [clip, expectText, after] of [["scroll-down-padded.wav", /scroll down/i, "scroll"]]) {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "voicenav-whisper-prof-")), {
      headless: false,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.join(here, "audio", clip)}%noloop`],
    });
    try {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log("page error:", e.message));
      await page.goto(`${BASE}/long.html`);
      await page.waitForSelector("#voicenav-host", { state: "attached", timeout: 10000 });
      await page.waitForTimeout(500);
      const host = (k) => page.evaluate((key) => document.querySelector("#voicenav-host").dataset[key], k);
      const status = () => page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("status").textContent);
      const say = async (cmd) => {
        const before = await page.evaluate(() => +(document.querySelector("#voicenav-host").dataset.handled || 0));
        await page.evaluate((c) => document.dispatchEvent(new CustomEvent("voicenav-command", { detail: c })), cmd);
        await page.waitForFunction((b) => +(document.querySelector("#voicenav-host").dataset.handled || 0) > b, before, { timeout: 15000 });
      };
      await say("use offline speech");
      check("'use offline speech' switches to Whisper", /Offline speech on/i.test(await status()), await status());
      check("scrolled to the top at the start", (await page.evaluate(() => scrollY)) === 0);
      // start listening: the fake microphone starts the recording the moment the stream opens
      await page.evaluate(() => document.querySelector("#voicenav-host").shadowRoot.getElementById("mic").click());
      const heard = await waitFor(() => host("sttLast"), 45000, 500);
      check("Whisper heard the spoken phrase", !!heard && expectText.test(heard), `heard: ${JSON.stringify(heard)} | ${await status()}`);
      const moved = await waitFor(async () => (await page.evaluate(() => scrollY)) > 100, 10000, 300);
      check("...and the page scrolled down by that command", !!moved, `scrollY=${await page.evaluate(() => scrollY)} | ${await status()}`);
    } finally { await ctx.close(); }
  }
} catch (e) { console.log("ERROR", e.message.split("\n")[0]); failed++; }
finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  stop(); server.close();
  process.exit(failed ? 1 : 0);
}
