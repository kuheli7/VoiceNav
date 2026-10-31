// The microphone lives here, in a page the extension owns, instead of in each website. Chrome asks for microphone permission
// per site, so listening from the website meant an "Allow?" box on every new site, which someone who can't use a mouse can't
// answer. The extension's own address is asked once (setup.html) and then covers every site. What is heard goes to the
// background worker, which hands it to the tab you are looking at.
// An offscreen page can use only chrome.runtime, so the worker sends it the settings (micConfig) and takes everything it reports.
const HALLUCINATIONS = /^(?:you|thank you\.?|thanks for watching\.?|bye\.?|\.+|um+|uh+)$/i; // what Whisper "hears" in silence

let on = false, lang = "en-IN", whisper = false; // settings, sent by the worker (`on`: voice is on and a tab can be seen)
let voice = false;                               // voice is on, whether or not a tab can be seen right now
let paused = false, pauseTimer = 0;              // a tab is speaking: VoiceNav must not hear (and obey) its own voice
let halted = "";                                 // why we stopped trying: needs-grant, no-microphone, speech-blocked, unsupported, checking
let micOk = false;                               // the microphone has opened once, so it is allowed
let rec = null, wh = null, starts = 0, lastError = { code: "", at: 0 };

const send = (m) => chrome.runtime.sendMessage(m).catch(() => { /* the worker is restarting, or the extension was reloaded */ });
const report = (state, detail) => send({ type: "micState", state, detail, lang, whisper, starts, active: !!(rec || wh), audio: wh?.ac?.state || "" });
const status = (text, hearing) => send({ type: "micStatus", text, hearing: !!hearing });
const heard = (alts, src) => send({ type: "heard", alts, src });

const wanted = () => on && !paused && !halted;

// Opens the microphone once and lets go. A clean "not allowed" here is how we know the one-time setup hasn't happened; the
// speech recognizer's own errors are vaguer ("not-allowed" can also mean the speech service is refused).
async function probe() {
  if (micOk) return true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return (micOk = true);
  } catch (e) {
    if (e?.name === "NotFoundError") { halted = "no-microphone"; report("error", "no-microphone"); }
    else { halted = "needs-grant"; report("needs-grant"); }
    return false;
  }
}

async function sync() {
  if (!wanted()) return stop();
  if (rec || wh) return;
  // Whisper opens the microphone itself (and reports a refusal itself); a probe first would use up a one-shot test recording
  if (!whisper && !(await probe())) return;
  if (!wanted() || rec || wh) return; // things changed while the permission check ran
  starts++;
  report("ready");
  whisper ? startWhisper() : startSpeech();
}

function stop() {
  const r = rec; rec = null;
  if (r) { r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* not running */ } }
  const w = wh; wh = null;
  if (w) {
    w.stopped = true;
    clearInterval(w.timer);
    try { w.stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { w.ac?.close(); } catch { /* closed */ }
  }
}

// ---------- Chrome's speech recognizer ----------
function startSpeech() {
  const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
  if (!SR) { halted = "unsupported"; return report("error", "unsupported"); }
  const r = rec = new SR();
  r.lang = lang; r.continuous = true; r.interimResults = false; r.maxAlternatives = 5;
  r.onstart = () => report("listening");
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) heard([...e.results[i]].map((a) => a.transcript), "speech");
    }
  };
  r.onerror = (e) => {
    if (e.error === "network") {
      const now = Date.now();
      if (lastError.code !== "network" || now - lastError.at > 20000) report("error", "network"); // say it once, not on every retry
      lastError = { code: "network", at: now };
    }
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      // Either the microphone permission went away since it was checked (a "just this once" grant ends), or the speech service
      // itself is refused. Ask the microphone which; "checking" keeps onend from restarting in the meantime.
      halted = "checking"; micOk = false;
      probe().then((ok) => { if (ok) { halted = "speech-blocked"; report("error", "speech-blocked"); } });
    }
  };
  // It stops after silence; keep going. After a network error wait longer so an offline laptop isn't hammering the service.
  r.onend = () => { if (rec === r) rec = null; if (wanted()) setTimeout(sync, lastError.code === "network" ? 3000 : 300); };
  try { r.start(); } catch { rec = null; }
}

// ---------- offline speech (Whisper through the local backend) ----------
// Cuts the microphone into phrases wherever you pause and has the backend turn each into text. No cloud, and it works in browsers
// without Chrome's speech service. A timer, not requestAnimationFrame: this page is never shown, and hidden pages don't get frames.
const toBase64 = (buf) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

async function sendClip(blob) {
  if (blob.size < 2500) return; // a click or a cough
  status("Thinking...");
  const r = await chrome.runtime.sendMessage({ type: "stt", audio: toBase64(await blob.arrayBuffer()), lang: lang === "hi-IN" ? "hi" : "en" }).catch(() => null);
  if (!r || r.error) {
    return status(r?.error === "not-installed" ? "Offline speech isn't installed: pip install -r backend/requirements-whisper.txt, then restart the backend"
      : r?.error === "timeout" ? "Offline speech took too long" : "The backend is offline, so offline speech can't work");
  }
  const text = (r.text || "").trim();
  if (!text || HALLUCINATIONS.test(text)) return status("Listening...");
  heard([text], "whisper");
}

async function startWhisper() {
  const me = wh = { stopped: false };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) {
    if (wh === me) wh = null;
    micOk = false;
    halted = e?.name === "NotFoundError" ? "no-microphone" : "needs-grant";
    return halted === "needs-grant" ? report("needs-grant") : report("error", "no-microphone");
  }
  if (me.stopped || wh !== me) { stream.getTracks().forEach((t) => t.stop()); return; }
  const ac = new AudioContext();
  // This page never gets a click, and a suspended AudioContext hands the analyser silence, so Whisper would never hear a phrase.
  // Say what state it ended up in (micState.audio) rather than assume.
  if (ac.state === "suspended") await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
  if (me.stopped || wh !== me) { stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); return; }
  const an = ac.createAnalyser(); an.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  const START = 0.015, END_SILENCE = 750, MAX_MS = 9000;
  let recorder = null, chunks = [], began = 0, lastLoud = 0;
  Object.assign(me, { stream, ac });
  ac.onstatechange = () => { if (wh === me) report("listening"); };
  const finish = () => {
    const r = recorder; recorder = null;
    if (r && r.state !== "inactive") r.stop();
  };
  me.timer = setInterval(() => {
    if (me.stopped) return;
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length), now = performance.now();
    if (rms > START) {
      lastLoud = now;
      if (!recorder) {
        chunks = []; began = now;
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const mine = recorder;
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = () => { if (!me.stopped) sendClip(new Blob(chunks, { type: mine.mimeType || "audio/webm" })); };
        recorder.start();
        status("Hearing you...", true);
      }
    }
    if (recorder && (now - lastLoud > END_SILENCE || now - began > MAX_MS)) finish();
  }, 40);
  report("listening");
}

// ---------- the worker's orders ----------
function configure(c) {
  const wasOn = on, wasVoice = voice, changed = (c.lang === "hi-IN" ? "hi-IN" : "en-IN") !== lang || !!c.whisper !== whisper;
  on = !!c.on; voice = c.voice === undefined ? on : !!c.voice; lang = c.lang === "hi-IN" ? "hi-IN" : "en-IN"; whisper = !!c.whisper;
  if (voice && !wasVoice) halted = ""; // switching voice on is a fresh try, whatever stopped it before (merely coming back to a tab is not)
  if (changed) { stop(); setTimeout(sync, 350); } // the language and the engine are fixed when a recognizer starts
  else sync();
  if (wasOn && !on) report("off"); // let go of the microphone and say so
}

function setPaused(p) {
  clearTimeout(pauseTimer);
  paused = p;
  if (p) pauseTimer = setTimeout(() => setPaused(false), 30000); // a tab that paused us and then went away must not leave us deaf
  if (p) report("paused");
  sync();
}

chrome.runtime.onMessage.addListener((m, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (m?.type === "micConfig") configure(m);
  else if (m?.type === "micPause") setPaused(!!m.paused);
  else if (m?.type === "micRetry") { halted = ""; micOk = false; sync(); } // setup.html got the permission
});

chrome.runtime.sendMessage({ type: "micReady" }).then((c) => { if (c) configure(c); }).catch(() => { /* the worker will push micConfig */ });
