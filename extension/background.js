// Service worker: talks to the local AI backend, and remembers whether voice is switched on.
// Content scripts can't fetch http://localhost from https pages (mixed content), but the worker can.
const BACKEND = "http://127.0.0.1:8000";

async function call(path, init, timeoutMs = 30000) {
  const res = await fetch(BACKEND + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw Object.assign(new Error(`backend ${res.status}`), { status: res.status });
  return res.json();
}

// "Voice is on" is one setting for the whole browser session, not one per tab. That's safe because only the tab you
// are looking at ever listens (hidden tabs pause themselves), and it means reloads, page navigation, links that open
// in a new tab (Amazon products do) and switching tabs all keep working without re-enabling the mic.
// storage.session survives the worker being stopped, and is cleared when the browser closes.
const VOICE_KEY = "voiceOn";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (msg.type === "interpret") {
    call("/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    })
      .then(sendResponse)
      .catch((e) => sendResponse(
        e?.name === "TimeoutError" ? { action: "none", message: "The AI is taking too long. Try a simpler command" }
        : e?.status ? { action: "none", message: `The AI had a problem (error ${e.status})` } // reachable, but it refused or failed
        : { action: "none", message: "AI backend is offline", offline: true }
      ));
    return true; // keep the channel open for the async reply
  }

  if (msg.type === "health") {
    call("/health", undefined, 5000)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // Offline speech: the page records a short clip, the worker posts it to the local backend's Whisper and returns the text.
  if (msg.type === "stt") {
    (async () => {
      const bytes = Uint8Array.from(atob(String(msg.audio || "")), (c) => c.charCodeAt(0));
      const res = await fetch(`${BACKEND}/transcribe?lang=${msg.lang === "hi" ? "hi" : "en"}`, { method: "POST", body: bytes, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw Object.assign(new Error(`backend ${res.status}`), { status: res.status });
      return res.json();
    })().then(sendResponse).catch((e) => sendResponse({ error: e?.status === 501 ? "not-installed" : e?.name === "TimeoutError" ? "timeout" : "offline" }));
    return true;
  }
  if (msg.type === "sttStatus") {
    call("/stt", undefined, 4000).then(sendResponse).catch(() => sendResponse({ available: false, offline: true }));
    return true;
  }

  // `host` says whether the microphone page (see "the microphone host" below) is listening for the tab, or the tab must do it itself.
  if (msg.type === "getVoice") {
    chrome.storage.session.get(VOICE_KEY).then(async (o) => sendResponse({ on: !!o[VOICE_KEY], host: o[VOICE_KEY] ? await ensureHost() : hostAvailable() }));
    return true;
  }

  if (msg.type === "setVoice") {
    const op = msg.on ? chrome.storage.session.set({ [VOICE_KEY]: true }) : chrome.storage.session.remove(VOICE_KEY);
    op.then(async () => {
      const host = await syncHost();
      sendResponse({ ok: true, host });
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: "voiceChanged", on: !!msg.on, host }).catch(() => {}); // tabs we can't reach are fine
    });
    return true;
  }

  // ----- the microphone host: what offscreen.js and setup.js tell us -----
  if (msg.type === "micReady") { // the page has just opened: here is what it should be doing
    readMicConfig().then(sendResponse);
    return true;
  }
  // Only the page the person is on speaks for the tab: not a frame, and not a page the browser is preparing in the background
  if (msg.type === "tabVisible" && sender.tab && sender.frameId === 0 && (!sender.documentLifecycle || sender.documentLifecycle === "active")) { noteTabVisible(sender.tab.id, !!msg.visible, Number(msg.at) || Date.now()); return false; }
  if (msg.type === "heard") { routeHeard(msg); return false; }
  if (msg.type === "micState") { onMicState(msg); return false; }
  if (msg.type === "micStatus") { toActiveTab({ type: "hostStatus", text: msg.text, hearing: !!msg.hearing }); return false; }
  if (msg.type === "micGranted") { chrome.runtime.sendMessage({ type: "micRetry" }).catch(() => {}); return false; }

  // "Undo" after a voice click. The worker notes which tab clicked what, and which tab a click opened, so undo can close that
  // tab or go back a page. Kept in storage.session because this worker is stopped when idle and forgets its variables.
  if (msg.type === "clickMade" && sender.tab) {
    chrome.storage.session.set({ lastClick: { tabId: sender.tab.id, at: Date.now(), url: msg.url, label: msg.label, navigates: !!msg.navigates, opensTab: !!msg.opensTab } });
    return false;
  }

  // A page that has just loaded asks: "did a click in this tab bring me here?" (works across sites, unlike sessionStorage)
  if (msg.type === "arrivedByClick" && sender.tab) {
    chrome.storage.session.get("lastClick").then(async ({ lastClick }) => {
      const hit = lastClick && lastClick.tabId === sender.tab.id && lastClick.navigates && Date.now() - lastClick.at < 6000 && sender.url !== lastClick.url;
      if (hit) await chrome.storage.session.set({ lastClick: { ...lastClick, navigates: false } }); // reported once
      sendResponse(hit ? { label: lastClick.label, url: lastClick.url } : {});
    });
    return true;
  }

  // "Undo" in the tab that clicked: close the tab that click opened (only if it really was THAT click's tab)
  if (msg.type === "undoNewTab" && sender.tab) {
    const opener = sender.tab.id;
    (async () => {
      // The note is written a moment after the new tab appears. If a click was only just made, give it a moment to arrive.
      let rec = null;
      for (let i = 0; i < 8; i++) {
        rec = (await chrome.storage.session.get(`opened:${opener}`))[`opened:${opener}`];
        if (rec) break;
        const { lastClick } = await chrome.storage.session.get("lastClick");
        if (!lastClick || lastClick.tabId !== opener || Date.now() - lastClick.at > 3000) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const sameClick = rec && (msg.clickAt == null || Math.abs(rec.clickAt - msg.clickAt) < 2500);
      if (!rec || !sameClick || Date.now() - rec.at > 120000) return sendResponse({ closed: false });
      try {
        await chrome.storage.session.remove(`opened:${opener}`);
        await chrome.tabs.remove(rec.tabId);
        await chrome.tabs.update(opener, { active: true });
        sendResponse({ closed: true });
      } catch { sendResponse({ closed: false }); } // the tab was already closed
    })();
    return true;
  }

  // "Undo" in the NEW tab itself (it has the focus after a click opened it, so that is where you will say it): close this tab
  // and go back to the one you came from
  if (msg.type === "undoThisTab" && sender.tab) {
    (async () => {
      const all = await chrome.storage.session.get(null);
      const key = Object.keys(all).find((k) => k.startsWith("opened:") && all[k].tabId === sender.tab.id && Date.now() - all[k].at < 120000);
      if (!key) return sendResponse({ closed: false });
      try {
        await chrome.storage.session.remove(key);
        await chrome.tabs.update(Number(key.slice(7)), { active: true });
        await chrome.tabs.remove(sender.tab.id);
        sendResponse({ closed: true });
      } catch { sendResponse({ closed: false }); }
    })();
    return true;
  }
  // ----- the voice log (read by options.html) -----
  if (msg.type === "log") { enqueueLog((log) => { log.push(msg.entry); }); return false; }
  if (msg.type === "logUpdate") { enqueueLog((log) => { const e = log.find((x) => x.id === msg.id); if (e) Object.assign(e, msg.patch); }); return false; }
  if (msg.type === "openLog") { chrome.runtime.openOptionsPage(); return false; }

  // ----- the rest of "open the project and then chat" when a step loaded another page -----
  if (msg.type === "chainSet" && sender.tab) {
    const key = `chain:${sender.tab.id}`;
    (msg.parts && msg.parts.length ? chrome.storage.session.set({ [key]: { parts: msg.parts, at: Date.now() } }) : chrome.storage.session.remove(key));
    return false;
  }
  if (msg.type === "chainGet" && sender.tab) {
    const key = `chain:${sender.tab.id}`;
    chrome.storage.session.get(key).then(async (o) => {
      const rec = o[key];
      if (rec) await chrome.storage.session.remove(key); // used once
      sendResponse(rec && Date.now() - rec.at < 30000 ? { parts: rec.parts } : {});
    });
    return true;
  }

  // a chain whose step moved you to another tab: leave the rest for the tab that is now showing
  if (msg.type === "chainMove" && sender.tab) {
    (async () => {
      const [active] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (active && active.id !== sender.tab.id) {
        await chrome.storage.session.set({ [`chain:${active.id}`]: { parts: msg.parts, at: Date.now() } });
        chrome.tabs.sendMessage(active.id, { type: "chainRun" }).catch(() => {}); // a page that is still loading picks it up itself
        return sendResponse({ moved: true });
      }
      sendResponse({ moved: false });
    })();
    return true;
  }

  if (msg.type === "trustedKey" && sender.tab) {
    trustedKey(sender.tab.id, msg.key || {}).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e).slice(0, 120) }));
    return true;
  }
  if (msg.type === "trustedClick" && sender.tab) {
    trustedClick(sender.tab.id, Number(msg.x), Number(msg.y)).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e).slice(0, 120) }));
    return true;
  }
  // ----- tabs -----
  if (msg.type === "tabs" && sender.tab) {
    tabsOp(msg, sender.tab).then(sendResponse).catch(() => sendResponse({ error: "The browser wouldn't do that" }));
    return true;
  }
  return false;
});

// ---- the microphone host ----
// Listening used to happen inside each website, and Chrome asks for the microphone once per website, so every new site put an
// "Allow?" question on screen that someone who can't use a mouse can't answer. Now one hidden extension page (offscreen.html)
// listens and the extension's own address is asked once (setup.html). What it hears comes here and goes to the tab you are on.
// Where the browser has no offscreen pages (or making one fails) tabs listen for themselves, as before.
const hostAvailable = () => !!(chrome.offscreen && chrome.runtime.getContexts);
const hostExists = () => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).then((c) => c.length > 0);

let hostChain = Promise.resolve(true); // creating it twice at once is an error, so ask one at a time
function ensureHost() {
  if (!hostAvailable()) return Promise.resolve(false);
  hostChain = hostChain.then(async () => {
    try {
      if (!(await hostExists())) {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["USER_MEDIA"],
          justification: "Listen for voice commands with a single microphone permission that covers every website",
        });
      }
      return true;
    } catch { return false; }
  });
  return hostChain;
}

// What the microphone page should be doing. It listens only while voice is on AND a VoiceNav tab can be seen: with Chrome
// minimised or covered nothing could act on what it heard, and the microphone (and the speech service) should not stay open for it.
async function readMicConfig() {
  const [session, local] = await Promise.all([chrome.storage.session.get([VOICE_KEY, SEEN_KEY]), chrome.storage.local.get(["lang", "useWhisper"])]);
  return { type: "micConfig", voice: !!session[VOICE_KEY], on: !!session[VOICE_KEY] && anySeen(session[SEEN_KEY]), lang: local.lang === "hi-IN" ? "hi-IN" : "en-IN", whisper: !!local.useWhisper };
}

// Make the microphone page match the settings. Returns whether it (rather than the tab) is doing the listening.
async function syncHost() {
  const { [VOICE_KEY]: voice } = await chrome.storage.session.get(VOICE_KEY);
  if (voice) {
    if (!(await ensureHost())) return false;
  } else if (!hostAvailable() || !(await hostExists().catch(() => false))) {
    return hostAvailable(); // nothing is running, so there is nothing to stop
  }
  chrome.runtime.sendMessage(await readMicConfig()).catch(() => {}); // a page that is still loading asks for this itself (micReady)
  return true;
}

// Each tab says whether it can be seen (content.js). `at` is when it said so, because the word of a page that is being left can
// arrive after the word of the page that replaced it. Kept in storage.session: this worker is stopped when idle.
const SEEN_KEY = "tabsSeen";
const anySeen = (seen) => Object.values(seen || {}).some((t) => t.v);
let seenChain = Promise.resolve(), idleTimer = 0;
function noteTabVisible(tabId, v, at, forget = false) {
  seenChain = seenChain.then(async () => {
    const seen = (await chrome.storage.session.get(SEEN_KEY))[SEEN_KEY] || {};
    const before = anySeen(seen);
    if (forget) delete seen[tabId];
    else if (!seen[tabId] || seen[tabId].at <= at) seen[tabId] = { v, at };
    else return;
    await chrome.storage.session.set({ [SEEN_KEY]: seen });
    clearTimeout(idleTimer);
    if (anySeen(seen)) { if (!before) await syncHost(); }
    else idleTimer = setTimeout(() => syncHost().catch(() => {}), 1000); // switching tabs is hidden-then-visible; don't restart the recognizer for it
  }).catch(() => {});
}
chrome.tabs.onRemoved.addListener((id) => noteTabVisible(id, false, 0, true));
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.lang || changes.useWhisper)) syncHost().catch(() => {}); });

// The tab in front: the active tab of the window you used last (not a DevTools or popup window)
async function activeTab() {
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const win = wins.find((w) => w.focused) || wins.find((w) => w.id === lastNormalWindow) || wins[0];
  if (!win) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab || null;
}
let lastNormalWindow = -1; // also kept in storage.session, because this worker is stopped when idle and forgets its variables
chrome.storage.session.get("lastNormalWindow").then((o) => { if (lastNormalWindow === -1 && o.lastNormalWindow) lastNormalWindow = o.lastNormalWindow; });
chrome.windows.onFocusChanged.addListener(async (id) => {
  if (id === chrome.windows.WINDOW_ID_NONE) return;
  try { if ((await chrome.windows.get(id)).type === "normal") { lastNormalWindow = id; chrome.storage.session.set({ lastNormalWindow: id }); } } catch { /* closed already */ }
});

async function toActiveTab(m) {
  const tab = await activeTab();
  if (tab) chrome.tabs.sendMessage(tab.id, m).catch(() => {}); // a browser page has no VoiceNav in it; nothing to tell
}
// Speech goes to one tab only. That tab drops it if it is hidden, switched off, or speaking.
function routeHeard(m) { return toActiveTab({ type: "heard", alts: m.alts, src: m.src }); }

async function onMicState(m) {
  const state = { state: m.state, detail: m.detail || "", lang: m.lang, whisper: !!m.whisper, starts: m.starts, active: !!m.active, audio: m.audio || "" };
  chrome.storage.session.set({ micState: { ...state, at: Date.now() } });
  await toActiveTab({ type: "hostState", ...state }); // before the setup page takes the front, or this would go to it instead
  if (m.state === "needs-grant") await openSetup();
}

// The page that asks for the microphone, brought to the front (the tab you came from is where you land when it closes itself)
async function openSetup() {
  const url = chrome.runtime.getURL("setup.html");
  const [open] = await chrome.tabs.query({ url });
  if (open) { await chrome.tabs.update(open.id, { active: true }); return chrome.windows.update(open.windowId, { focused: true }); }
  const from = await activeTab();
  return chrome.tabs.create({ url, active: true, ...(from ? { openerTabId: from.id, windowId: from.windowId } : {}) });
}

// ---- trusted click: a genuine mouse press through Chrome's debugger, for pages that ignore scripted clicks ----
// Chrome shows its "debugging this browser" bar while attached, so attach only for the click itself and detach straight away.
async function trustedClick(tabId, x, y) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    const send = (type, extra) => chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type, x, y, ...extra });
    await send("mouseMoved");
    await send("mousePressed", { button: "left", buttons: 1, clickCount: 1 });
    await send("mouseReleased", { button: "left", buttons: 0, clickCount: 1 });
    return { ok: true };
  } finally {
    try { await chrome.debugger.detach(target); } catch { /* already detached */ }
  }
}

// A genuine key press (page scripts can't fake one): for shortcuts like Ctrl+Shift+S that web apps listen for.
async function trustedKey(tabId, k) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    const mods = (k.alt ? 1 : 0) | (k.ctrl ? 2 : 0) | (k.shift ? 8 : 0);
    const base = { key: String(k.key), code: String(k.code), windowsVirtualKeyCode: Number(k.vk), nativeVirtualKeyCode: Number(k.vk), modifiers: mods };
    const printable = !k.ctrl && !k.alt && String(k.key).length === 1;
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: printable ? "keyDown" : "rawKeyDown", ...base, ...(printable ? { text: String(k.key) } : {}) });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
    return { ok: true };
  } finally {
    try { await chrome.debugger.detach(target); } catch { /* already detached */ }
  }
}

// ---- log storage: one write at a time, so two tabs logging together can't overwrite each other ----
let logChain = Promise.resolve();
function enqueueLog(edit) {
  logChain = logChain.then(async () => {
    const { vnlog = [] } = await chrome.storage.local.get("vnlog");
    edit(vnlog);
    while (vnlog.length > 800) vnlog.shift();
    await chrome.storage.local.set({ vnlog });
  }).catch(() => {});
}

// ---- tabs ----
// Voice runs inside a page, so a tab that is a browser page (chrome://, the Web Store, a blank new tab) can't be listened in.
// Never switch to one without saying so, and a "new tab" opens a page that works.
const scriptable = (url) => /^(https?|file):/.test(url || "") && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return "/"; } };

async function tabsOp(msg, from) {
  const tabs = (await chrome.tabs.query({ windowId: from.windowId })).sort((a, b) => a.index - b.index);
  const cur = tabs.findIndex((t) => t.id === from.id);
  const label = (t) => `"${(t.title || hostOf(t.url) || "tab").slice(0, 40)}"`;
  const show = async (t) => { await chrome.tabs.update(t.id, { active: true }); return { message: `Switched to ${label(t)}` }; };
  switch (msg.op) {
    case "new": {
      await chrome.tabs.create({ url: msg.url || "https://www.google.com/", windowId: from.windowId, active: true, openerTabId: from.id });
      return { message: msg.url ? `Opened ${msg.name || hostOf(msg.url)} in a new tab` : "Opened a new tab (Google). Say where to go" };
    }
    case "next": case "prev": {
      const step = msg.op === "next" ? 1 : -1;
      for (let i = 1; i < tabs.length; i++) {
        const t = tabs[(cur + step * i + tabs.length * i) % tabs.length];
        if (scriptable(t.url)) return show(t);
      }
      return { error: "There is no other tab I can switch to" };
    }
    case "index": {
      const t = msg.n === -1 ? tabs[tabs.length - 1] : tabs[msg.n - 1];
      if (!t) return { error: `There is no tab ${msg.n}. You have ${tabs.length}` };
      if (t.id === from.id) return { message: `You are already on tab ${tabs.indexOf(t) + 1}` };
      if (!scriptable(t.url)) return { error: `Tab ${tabs.indexOf(t) + 1} is a browser page. Voice can't run there, so I didn't switch` };
      return show(t);
    }
    case "site": {
      const siteHost = hostOf(msg.url), sitePath = pathOf(msg.url);
      // "google" is the search page, not Maps or Docs, which share its address
      const byHost = tabs.filter((t) => hostOf(t.url) === siteHost && (sitePath === "/" ? (siteHost !== "google.com" || pathOf(t.url) === "/" || pathOf(t.url).startsWith("/search")) : pathOf(t.url).startsWith(sitePath)));
      const matches = byHost.length ? byHost : tabs.filter((t) => scriptable(t.url) && (t.title || "").toLowerCase().includes(msg.name));
      if (matches.some((t) => t.id === from.id)) return { message: `You are already on ${msg.name}` };
      const t = matches.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (t) return show(t);
      await chrome.tabs.create({ url: msg.url, windowId: from.windowId, active: true });
      return { message: `No ${msg.name} tab was open, so I opened one` };
    }
    case "list":
      return { tabs: tabs.map((t, i) => ({ index: i + 1, title: t.title, host: hostOf(t.url), active: t.id === from.id })) };
    case "close":
      if (tabs.length < 2) return { error: "That is your only tab. I won't close the whole window" };
      await chrome.tabs.remove(from.id);
      return { message: "Closed this tab" };
    case "reopen": {
      const r = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
      const lastTab = r.find((x) => x.tab); // not a whole closed window
      if (!lastTab) return { error: "No closed tab to bring back" };
      await chrome.sessions.restore(lastTab.tab.sessionId);
      return { message: "Brought back the closed tab" };
    }
    case "windowFullscreen": {
      // only undo what we did: remember the state before we made the window full, and restore only that
      const key = `fsPrev:${from.windowId}`;
      if (msg.on) {
        const w = await chrome.windows.get(from.windowId);
        if (w.state !== "fullscreen") await chrome.storage.session.set({ [key]: w.state });
        await chrome.windows.update(from.windowId, { state: "fullscreen" });
      } else {
        const prev = (await chrome.storage.session.get(key))[key];
        if (prev) { await chrome.storage.session.remove(key); await chrome.windows.update(from.windowId, { state: prev }); }
      }
      return {};
    }
  }
  return { error: "I don't know that tab command" };
}

// A tab that appears right after a voice click was opened by that click. (A blank new-tab page you opened yourself is not.)
chrome.tabs.onCreated.addListener(async (tab) => {
  // Chrome records which tab opened a tab that came from a link or window.open. A tab you open yourself (Ctrl+T, a bookmark)
  // has no opener, so it can never be mistaken for the click's tab.
  const { lastClick } = await chrome.storage.session.get("lastClick");
  if (lastClick && lastClick.opensTab && Date.now() - lastClick.at < 3000 && tab.openerTabId === lastClick.tabId) {
    await chrome.storage.session.set({ [`opened:${lastClick.tabId}`]: { tabId: tab.id, at: Date.now(), clickAt: lastClick.at } });
  }
});

// Tabs that were open before the extension was installed, updated or reloaded have no VoiceNav in them (the browser only
// adds content scripts to pages loaded afterwards), which used to mean refreshing every tab by hand. Put it in them now.
// A tab that already has a live copy ignores the second one (see the guard at the top of content.js).
async function injectIntoOpenTabs() {
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map((t) =>
    chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {}))); // store pages, error pages etc. refuse; fine
}
chrome.runtime.onInstalled.addListener(() => { injectIntoOpenTabs(); });
