(() => {
  if (window.top !== window || window.__voicenav) return;
  window.__voicenav = true;

  // ---------- config ----------
  // Speech recognition language. Chrome listens for one language at a time; changed by voice ("hindi mein bolo",
  // "speak english") or the language chip, remembered in chrome.storage.local. Hindi/Hinglish text is understood in both.
  let lang = "en-IN";
  const TEST_HOOK = false; // tests build a copy with this on; never ship it on (a page could drive the extension)
  const MAX_AI_ELEMENTS = 40;
  const RISKY = /\b(buy now|place (your )?order|pay|checkout|purchase|delete|remove account|confirm order|submit order|sign out|log ?out|subscribe|unsubscribe)\b/i;
  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,' +
    '[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],' +
    '[role=switch],[role=option],[contenteditable=""],[contenteditable=true],' +
    '[tabindex]:not([tabindex="-1"]),[onclick],[role=row][jsaction],[role=row][tabindex]';
  const TEXTY = "input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url],input[type=tel],input[type=number],input[type=password],textarea,[contenteditable=true],[contenteditable=''],[contenteditable=plaintext-only]";

  // ---------- UI (shadow DOM keeps page CSS out) ----------
  const host = document.createElement("div");
  host.id = "voicenav-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .badge{position:fixed;background:#ffd400;color:#000;font:700 12px/1 system-ui,sans-serif;
        padding:2px 5px;border-radius:4px;border:1px solid #000;box-shadow:0 1px 3px #0006;}
      .panel[data-v=bottom]{bottom:16px} .panel[data-v=top]{top:16px}
      .panel[data-h=right]{right:16px} .panel[data-h=left]{left:16px}
      .panel.compact{padding:5px;gap:0}
      .panel.compact .text,.panel.compact .chip,.panel.compact .ai{display:none}
      .panel.hidden{display:none}
      .panel{position:fixed;pointer-events:auto;display:flex;gap:10px;
        align-items:center;background:#111;color:#fff;font:14px system-ui,sans-serif;
        padding:10px 14px;border-radius:999px;box-shadow:0 4px 16px #0006;max-width:min(420px,90vw);}
      button{all:unset;cursor:pointer;width:38px;height:38px;border-radius:50%;background:#444;
        display:grid;place-items:center;font-size:18px;flex:none;}
      button:focus-visible{outline:3px solid #ffd400;}
      button.on{background:#d6293e;animation:pulse 1.4s infinite;}
      @keyframes pulse{50%{box-shadow:0 0 0 8px #d6293e44}}
      .text{display:flex;flex-direction:column;min-width:0}
      .status{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .heard{opacity:.7;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button.asleep{background:#8a6d00;animation:none}
      button.chip{width:auto;height:auto;border-radius:999px;padding:3px 8px;font-size:11px;background:#444;animation:none}
      button.chip.on{background:#1d4ed8}
      button[hidden]{display:none}
      .ai{font-size:11px;padding:2px 7px;border-radius:999px;background:#444;flex:none}
      .ai.up{background:#1d7a46}
      .card{position:fixed;left:50%;top:10%;transform:translateX(-50%);width:min(580px,92vw);max-height:72vh;overflow:auto;
        pointer-events:auto;background:#111;color:#fff;border-radius:16px;padding:14px 20px 12px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 32px #000b}
      .card[hidden]{display:none}
      .card h2{font-size:16px;margin:0 0 6px} .card .sub{font-weight:600;margin-top:8px;color:#ffd400}
      .cursor{position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;opacity:0;transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .2s;z-index:2}
      .cursor.show{opacity:1}
      .cursor svg{width:22px;height:22px;filter:drop-shadow(0 1px 2px #0008)}
      .ripple{position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:3px solid #ffd400;pointer-events:none;animation:ripple .5s ease-out forwards}
      @keyframes ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
      .card ul{margin:2px 0 4px;padding-left:20px} .card .hint{opacity:.65;font-size:12px;margin-top:8px}
    </style>
    <div id="badges"></div>
    <div class="cursor" id="cursor" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
    <div class="card" id="card" role="dialog" aria-label="VoiceNav help" hidden></div>
    <div class="panel" data-v="bottom" data-h="right" role="region" aria-label="Voice control">
      <button id="mic" aria-label="Toggle voice control (Alt+V)" title="Alt+V">🎤</button>
      <div class="text">
        <span class="status" id="status" aria-live="polite">Voice off. Press Alt+V</span>
        <span class="heard" id="heard"></span>
      </div>
      <button id="lang" class="chip" aria-label="Speech language: English. Click for Hindi" title="Speech language. Or say &quot;Hindi mein bolo&quot; / &quot;speak English&quot;">EN</button>
      <button id="dict" class="chip on" hidden aria-label="Dictating. Click to stop" title="Everything you say is being typed. Click or say &quot;stop dictation&quot;">Dictating</button>
      <button id="att" class="chip" aria-label="Wake word mode" title="When on, start every command with Nova or Computer, so normal conversation is ignored">Wake: off</button>
      <span class="ai" id="ai" title="Local AI backend">AI off</span>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const micBtn = $("mic"), statusEl = $("status"), heardEl = $("heard"), badgesEl = $("badges"), aiEl = $("ai"), attBtn = $("att"), langBtn = $("lang"), dictBtn = $("dict");
  dictBtn.addEventListener("click", () => stopDictation());

  // The pill shrinks to just the mic button after a few quiet seconds so it stops covering the page,
  // and grows back whenever it has something to say or the pointer is over it.
  const panel = root.querySelector(".panel");
  let compactTimer;
  let dictating = null; // set while dictation is on (see "forms and dictation"): the pill stays open so it is obvious
  const showFull = () => { panel.classList.remove("compact"); clearTimeout(compactTimer); };
  const wake = () => { showFull(); compactTimer = setTimeout(() => { if (!dictating) panel.classList.add("compact"); }, 5000); };
  panel.addEventListener("pointerenter", showFull);
  panel.addEventListener("pointerleave", wake);
  panel.addEventListener("focusin", showFull);
  panel.addEventListener("focusout", wake);
  const say = (msg) => { statusEl.textContent = msg; wake(); noteSay(msg); if (talkBack && typeof speak === "function" && !dictating && !/^(?:Listening|Heard)/.test(msg)) speak(msg); };
  wake();

  // Where the pill sits. Remembered across pages; changed by voice ("move panel to the top left").
  function placePanel(v, h, save = true) {
    panel.dataset.v = v; panel.dataset.h = h;
    if (save) try { chrome.storage.local.set({ panelPos: { v, h } }); } catch {}
  }
  try { chrome.storage.local.get("panelPos").then((o) => { if (o.panelPos) placePanel(o.panelPos.v, o.panelPos.h, false); }); } catch {}

  // ---------- page understanding ----------
  // What is on top at a point, ignoring VoiceNav's own pill and cards: they sit above everything, and must not make every
  // page element under them look "covered" (the help card spans a good part of the screen).
  function topAt(x, y) {
    return document.elementsFromPoint(x, y).find((e) => e !== host && !host.contains(e)) || null;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    // A native <select> is the accessible control even when the page paints its own look-alike over it (Amazon's "Sort by")
    if (el.tagName === "SELECT") return true;
    if (s.opacity === "0") {
      // Amazon-style buttons: the real <input> is transparent and sits over a styled label.
      // It's a genuine click target if nothing else is on top of it.
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      return topAt(x, y) === el;
    }
    return true;
  }

  // The element's name as a screen reader would give it. `full` is untruncated (used to match what you said);
  // labelOf is the short form shown to you and sent to the AI.
  function fullLabel(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      if (t) return t;
    }
    if (el.labels && el.labels[0]) return el.labels[0].textContent.trim();
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (text) return text.slice(0, 300);
    return (
      el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("placeholder") ||
      el.querySelector("img[alt]")?.alt || el.value || el.name || ""
    ).toString().trim().slice(0, 300);
  }
  const labelOf = (el) => fullLabel(el).slice(0, 80);

  // "How long does it take to learn Python?": a question that expands when clicked (Google's "People also ask")
  function questionText(el) {
    if (!el.matches('button,summary,[role=button],[aria-expanded]')) return null; // not plain links: a headline ending in ? is a story
    const first = (el.innerText || "").trim().split("\n")[0].trim();
    return first.length > 3 && first.length < 220 && first.endsWith("?") ? first : null;
  }

  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "select") return "dropdown";
    if (tag === "textarea") return "textbox";
    if (tag === "input") return ["checkbox", "radio", "submit", "button"].includes(el.type) ? el.type : "textbox";
    return tag === "summary" ? "button" : tag;
  }

  // Product cards usually show the price near the link, not inside it, so look at a few ancestors.
  const PRICE = /(?:₹|rs\.?|inr|\$|€|£)\s?(\d[\d,]*(?:\.\d+)?)/i;
  function priceOf(el) {
    for (let n = el, depth = 0; n && n !== document.body && depth < 4; n = n.parentElement, depth++) {
      const text = (n.textContent || "").slice(0, 400); // textContent is far cheaper than innerText, which forces layout
      const m = text.match(PRICE);
      if (m) return parseFloat(m[1].replace(/,/g, ""));
      if (n.querySelectorAll(INTERACTIVE).length > 6) break; // too broad, we've left the card
    }
    return null;
  }

  // True when something else (an open popup, its backdrop, a sticky header) sits on top of the element,
  // so a real user couldn't click it. Without this, a popup would still number and click everything behind it.
  function isCovered(el) {
    const r = el.getBoundingClientRect();
    const x = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2;
    const y = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
    const top = topAt(x, y);
    if (!top) return false;
    return !(el.contains(top) || (el.labels && [...el.labels].some((l) => l.contains(top))));
  }

  let items = []; // [{el, label}] in on-screen order; index+1 is the spoken number
  function scan() {
    const found = [...document.querySelectorAll(INTERACTIVE)].filter(
      (el) => !host.contains(el) && !el.disabled && isVisible(el) && (el.tagName === "SELECT" || !isCovered(el))
    );
    const kept = found.filter((el) => el.matches("[role=row]") || !found.some((o) => o !== el && el.contains(o) && !el.matches("a,button")));
    kept.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return Math.round(ra.top / 20) - Math.round(rb.top / 20) || ra.left - rb.left;
    });
    items = kept.map((el) => ({ el, label: labelOf(el), full: fullLabel(el) }));
    return items;
  }

  let numbersOn = false;
  function drawBadges() {
    badgesEl.innerHTML = "";
    if (!numbersOn) return;
    scan().forEach(({ el }, i) => {
      const r = el.getBoundingClientRect();
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = i + 1;
      b.style.left = Math.max(0, r.left) + "px";
      b.style.top = Math.max(0, r.top) + "px";
      badgesEl.appendChild(b);
    });
  }
  let redrawTimer;
  const scheduleRedraw = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(drawBadges, 150); };
  addEventListener("scroll", scheduleRedraw, { passive: true, capture: true });
  addEventListener("resize", scheduleRedraw);
  if (document.body) new MutationObserver(scheduleRedraw).observe(document.body, { childList: true, subtree: true });

  // ---------- actions ----------
  // What actually scrolls: usually the page, but app-style sites (chat panes, Gmail, docs) lock the page and scroll an inner
  // panel instead. A locked page can still report a big scrollHeight and never move, so look for something that can move.
  // Chat panes often use flex-direction: column-reverse, where scrollTop is 0 at the bottom and goes NEGATIVE going up:
  // "scrollTop > 0" would then say a chat can never scroll up.
  function canMove(el, dir) {
    const max = el.scrollHeight - el.clientHeight, t = el.scrollTop;
    const reversed = t < 0 || /column-reverse/.test(getComputedStyle(el).flexDirection);
    if (reversed) return dir === "up" ? t > -max + 1 : t < -1;
    return dir === "up" ? t > 0 : t < max - 1;
  }
  // The scrollable panel on the left or right edge (a chat list, a sidebar), the middle, or a list
  function areaScroller(dir, area) {
    const xs = area === "left" ? [0.03, 0.07, 0.11, 0.15, 0.2] : area === "right" ? [0.97, 0.93, 0.89, 0.85] : [0.5, 0.4, 0.6];
    let best = null, bestArea = 0;
    for (const fx of xs) for (const fy of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      for (let el = document.elementFromPoint(innerWidth * fx, innerHeight * fy); el && el !== document.documentElement; el = el.parentElement) {
        if (host.contains(el)) break;
        const oy = getComputedStyle(el).overflowY;
        if (!(oy === "auto" || oy === "scroll" || oy === "overlay") || el.scrollHeight <= el.clientHeight + 2 || !canMove(el, dir)) continue;
        if ((area === "left" || area === "right") && el.clientWidth > innerWidth * 0.6) continue; // that is the page, not a side panel
        const a = el.clientWidth * el.clientHeight;
        if (a > bestArea) { best = el; bestArea = a; }
      }
    }
    return best;
  }
  function scrollTarget(dir = "down", area) {
    if (area === "left" || area === "right") return areaScroller(dir, area);
    const se = document.scrollingElement;
    const locked = [document.documentElement, document.body].some((e) => e && /hidden|clip/.test(getComputedStyle(e).overflowY));
    if (!locked && se.scrollHeight > innerHeight + 2 && canMove(se, dir)) return se;
    // otherwise the biggest scrollable panel under a few points on screen
    let best = null, bestArea = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5], [0.8, 0.8]]) {
      for (let el = document.elementFromPoint(innerWidth * fx, innerHeight * fy); el && el !== document.documentElement; el = el.parentElement) {
        if (host.contains(el)) break;
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight + 2 && canMove(el, dir)) {
          const area = el.clientWidth * el.clientHeight;
          if (area > bestArea) { best = el; bestArea = area; }
        }
      }
    }
    return best || se;
  }

  // Remembered so a "slowly" that arrives as its own phrase can continue the scroll just before it
  let lastScroll = null;
  const noteScroll = (dir) => { lastScroll = { dir, at: Date.now() }; };

  function scrollPage(dir, fraction, area) {
    noteScroll(dir);
    const target = scrollTarget(dir, area);
    if (!target) return say(`Nothing to scroll ${dir} on the ${area} side of this page`);
    rememberScroll(target);
    const dy = (dir === "down" ? 1 : -1) * (target === document.scrollingElement ? innerHeight : target.clientHeight) * fraction;
    if (target === document.scrollingElement) return window.scrollBy({ top: dy, behavior: TEST_HOOK ? "instant" : "smooth" });
    target.scrollBy({ top: dy, behavior: TEST_HOOK ? "instant" : "smooth" });
  }

  // ---------- continuous scrolling ("scroll down slowly") ----------
  const SPEEDS = { slow: 60, medium: 160, fast: 420 }; // pixels per second
  let auto = null; // { dir, pps, target, last, carry, stuck, raf }

  function stopAutoScroll(announce) {
    if (!auto) return false;
    cancelAnimationFrame(auto.raf);
    auto = null;
    if (announce) say("Stopped scrolling");
    return true;
  }

  function startAutoScroll(dir, speed) {
    stopAutoScroll(false);
    noteScroll(dir);
    auto = { dir, pps: SPEEDS[speed] || SPEEDS.medium, target: scrollTarget(dir), last: performance.now(), carry: 0, stuck: 0, raf: 0, repicked: false };
    rememberScroll(auto.target);
    const tick = (now) => {
      if (!auto) return;
      const dt = Math.min(now - auto.last, 100); // a throttled tab shouldn't cause a big jump
      auto.last = now;
      auto.carry += (auto.dir === "down" ? 1 : -1) * auto.pps * dt / 1000;
      const step = Math.trunc(auto.carry);
      if (step) {
        auto.carry -= step;
        const before = auto.target.scrollTop;
        (auto.target === document.scrollingElement ? window : auto.target).scrollBy({ top: step, behavior: "instant" });
        auto.stuck = auto.target.scrollTop === before ? auto.stuck + 1 : 0;
        if (auto.stuck >= 5) {
          // Not moving. Either we're at the end, or we picked the wrong thing to scroll: look once more before giving up.
          const other = auto.repicked ? auto.target : scrollTarget(auto.dir);
          if (other !== auto.target) { auto.target = other; auto.repicked = true; auto.stuck = 0; }
          else { stopAutoScroll(false); return say("Reached the end"); }
        }
      }
      auto.raf = requestAnimationFrame(tick);
    };
    auto.raf = requestAnimationFrame(tick);
    say(`Scrolling ${dir} (${speed || "medium"}). Say "stop"`);
  }

  // Touching the mouse, keyboard or screen takes over from the voice scroll
  for (const ev of ["wheel", "touchstart", "mousedown", "keydown"]) {
    addEventListener(ev, (e) => { if (auto && e.isTrusted && !e.composedPath().includes(host)) stopAutoScroll(true); }, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopAutoScroll(false); });

  const boxText = (el) => (el ? (el.isContentEditable ? el.innerText : el.value || "") : "").trim();

  function setValue(el, text) {
    if (el.isContentEditable) {
      // Rich editors (ProseMirror on Claude/ChatGPT, Quill on Gemini) keep their own copy of the text and only update it
      // from the browser's real editing events. execCommand produces exactly those (beforeinput/input, trusted), so the
      // editor's state, and with it the Send button, stays in sync. Writing innerHTML directly would leave Send disabled.
      el.focus();
      document.execCommand("selectAll", false);
      if (text) document.execCommand("insertText", false, text);
      else document.execCommand("delete", false);
      if (boxText(el) === text.trim()) return true;
      // An editor that refused the command: write the text and announce it the way the browser would
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return boxText(el) === text.trim();
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text); // works with React-style inputs
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ---------- which text box: a search field or a chat's message box ----------
  // Chat panels and some editors live inside open shadow roots, which document.querySelectorAll can't see (our own panel is skipped)
  function queryDeep(sel, rootNode = document) {
    const out = [...rootNode.querySelectorAll(sel)];
    for (const el of rootNode.querySelectorAll("*")) if (el.shadowRoot && el !== host) out.push(...queryDeep(sel, el.shadowRoot));
    return out;
  }
  const activeDeep = () => { let a = document.activeElement; while (a && a !== host && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const visibleBoxes = () => queryDeep(TEXTY).filter((e) => !host.contains(e) && !e.disabled && !e.readOnly && isVisible(e));
  function isSearchy(el) {
    return el.type === "search" || el.name === "q" || !!el.closest("[role=search]") ||
      /search|query/i.test(`${el.name || ""} ${el.id} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`);
  }
  // How much a box looks like a chat's message box: a textarea or rich editor named like "Message...", "Ask anything",
  // "Write your prompt", "Enter a prompt here". Search fields and email/password/number inputs score below zero.
  const COMPOSER_HINT = /message|\bask\b|prompt|chat|reply|write|talk|compose/i;
  function composerScore(el) {
    const names = [el, el.parentElement, el.querySelector?.("[data-placeholder]")].filter(Boolean)
      .map((n) => `${n.getAttribute("aria-label") || ""} ${n.getAttribute("placeholder") || ""} ${n.getAttribute("data-placeholder") || ""}`).join(" ");
    let s = 0;
    if (el.isContentEditable || el.tagName === "TEXTAREA") s += 2;
    if (el.getAttribute("role") === "textbox") s += 1;
    if (COMPOSER_HINT.test(`${names} ${el.id}`)) s += 3;
    if (isSearchy(el)) s -= 6;
    if (el.tagName === "INPUT" && el.type !== "text") s -= 6;
    return s;
  }
  // The box a message should go into: the focused box unless it's a search field, else the most chat-like visible box
  function composerBox() {
    const a = activeDeep();
    if (a?.matches?.(TEXTY) && !host.contains(a) && !isSearchy(a)) return a;
    const boxes = visibleBoxes();
    return boxes.map((el, i) => ({ el, i, s: composerScore(el) })).sort((x, y) => y.s - x.s || x.i - y.i)[0]?.el || null;
  }

  // "type ...": the focused box; with nothing focused, a chat's message box if the page has one, else the first box.
  // (On Claude, the first box on the page is the sidebar's chat search, not the message box.)
  function typeTarget() {
    const a = activeDeep();
    if (a && a.matches?.(TEXTY) && !host.contains(a)) return a;
    const boxes = visibleBoxes();
    const chat = boxes.map((el, i) => ({ el, i, s: composerScore(el) })).filter((x) => x.s >= 3).sort((x, y) => y.s - x.s || x.i - y.i)[0];
    return chat?.el || boxes[0] || null;
  }
  // Google Docs types through a hidden iframe, not a visible text box. Without this, "type" found the Gemini side panel instead.
  function docsEditor() {
    if (location.hostname !== "docs.google.com") return null;
    try {
      for (const frame of document.querySelectorAll("iframe.docs-texteventtarget-iframe,iframe[class*=texteventtarget]")) {
        const d = frame.contentDocument;
        const ed = d && (d.querySelector("[contenteditable]") || (d.designMode === "on" || d.body?.isContentEditable ? d.body : null));
        if (ed) return { doc: d, ed, frame };
      }
    } catch { /* cross-origin frame */ }
    return null;
  }
  // Put text into the Docs page itself (never the title box or a side panel)
  function typeInDocument(text) {
    const docs = docsEditor();
    if (!docs) return say("Can't find the document's editor. Click on the page once, then try again");
    docs.frame.focus(); docs.ed.focus();
    const ok = docs.doc.execCommand("insertText", false, text);
    if (!ok) { // announce the text the way the keyboard would
      docs.ed.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      docs.ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    say(`Typed "${text}" in the document`);
  }
  // The title box at the top of Docs, Sheets and Slides
  function renameDoc(text) {
    const t = document.querySelector("input.docs-title-input");
    if (!t) return say("Couldn't find the title box");
    pushUndo({ kind: "text", el: t, prev: t.value });
    t.focus(); t.select();
    document.execCommand("insertText", false, text);
    if (t.value !== text) setValue(t, text);
    for (const type of ["keydown", "keypress", "keyup"]) t.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    t.blur();
    say(`Renamed to "${text}"`);
  }
  // A box named by what it belongs to: "the Gemini box" is the box inside (or labelled as) the Gemini panel
  function boxByPurpose(name) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    const hit = (b) => !!b.closest(`[aria-label*="${name}" i],[class*="${name}" i],[id*="${name}" i],[data-tooltip*="${name}" i]`) || re.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("placeholder") || ""}`);
    return visibleBoxes().filter(hit).sort((x, y) => composerScore(y) - composerScore(x))[0] || null;
  }
  function searchBox() {
    const boxes = visibleBoxes();
    return boxes.find(isSearchy) || boxes[0] || null;
  }
  function submit(el) {
    const form = el.closest("form");
    if (form) return form.requestSubmit ? form.requestSubmit() : form.submit();
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
  }

  // ---------- sending a chat message ----------
  // Chat sites ignore a synthetic Enter key, and their Send button is disabled (or not there at all) until the editor has
  // registered the text. So: find the Send button next to the message box, wait briefly for it to become usable, click it.
  const BUTTONS = 'button,[role=button],input[type=submit],input[type=image]';
  const SEND_NAME = /\b(?:send|submit|run|ask)\b/i;
  // Buttons that sit next to Send but must never be pressed for it
  const NOT_SEND = /voice|dictat|micro|\bmic\b|speech|record|attach|upload|\bfiles?\b|image|photo|emoji|\bstop\b|cancel|feedback|search|model|settings|\bmenu\b/i;
  const buttonName = (b) => `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.getAttribute("data-testid") || ""} ${b.id} ${b.tagName === "INPUT" ? b.value : ""} ${(b.textContent || "").trim().slice(0, 40)}`;
  const isUsable = (b) => !!b && b.isConnected && !b.disabled && b.getAttribute("aria-disabled") !== "true" && !b.closest("[inert]") && b.getClientRects().length > 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Looks outwards from the box, one container at a time, so the nearest Send wins. A form is the boundary (a search form
  // must not reach a chat's Send elsewhere on the page), and so is a container that has grown to most of the page.
  function findSendButton(box) {
    const boxForm = box.closest("form");
    // A button inside some other form (an order form, a newsletter sign-up) is never this box's Send
    const shown = (b) => !host.contains(b) && !box.contains(b) && b.closest("form") === boxForm &&
      b.getClientRects().length > 0 && getComputedStyle(b).visibility !== "hidden";
    let level = 0;
    for (let n = box.parentElement; n && n !== document.documentElement && level < (isSearchy(box) ? 4 : 12); n = n.parentElement, level++) {
      const all = [...n.querySelectorAll(BUTTONS)].filter(shown);
      if (all.length > 40) break;
      const named = all.filter((b) => SEND_NAME.test(buttonName(b)) && !NOT_SEND.test(buttonName(b)));
      if (named.length) return named.find((b) => /\bsend\b/i.test(buttonName(b))) || named[0];
      if (n.tagName === "FORM") return all.find((b) => (b.type === "submit" || b.type === "image") && !NOT_SEND.test(buttonName(b))) || null;
    }
    return null;
  }

  function pressEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  // text: type this first ("ask ...", "type ... and send"). done: what to report ("Sent", or "Submitted" for "submit").
  async function sendMessage(text, done = "Sent") {
    let box = text != null ? composerBox() : null;
    if (text != null) {
      if (!box) return say("No message box found");
      box.focus();
      if (!setValue(box, text)) return say("Couldn't type into the message box");
    } else {
      const a = document.activeElement;
      box = a?.matches?.(TEXTY) && !host.contains(a) && (boxText(a) || done !== "Sent") ? a : done === "Sent" ? composerBox() : typeTarget();
      if (!box) return say(done === "Sent" ? "No message box found" : "Nothing to submit");
    }
    const hadText = boxText(box);
    let btn = findSendButton(box);
    // Just typed and Send is already enabled (it was enabled for earlier text): give the editor a moment to take in the new text
    if (text != null && isUsable(btn)) { await sleep(120); btn = findSendButton(box); }
    if (!hadText && !isUsable(btn)) return say(done === "Sent" ? 'The message box is empty. Say "type" and your message' : "Nothing to submit");
    // The button is often disabled, or not there yet, until the editor catches up with the typing: wait for it (bounded).
    // Search boxes don't do this, so they don't wait.
    const deadline = performance.now() + (isSearchy(box) ? 0 : 2000);
    while (!isUsable(btn) && performance.now() < deadline) { await sleep(50); btn = findSendButton(box); }
    if (isUsable(btn)) {
      const label = labelOf(btn) || "Send";
      if (RISKY.test(label)) return askFirst(label, () => { press(btn); say(`Clicked "${label}"`); }); // "Submit order" etc.
      const textBefore = boxText(box);
      const gone = async (ms, test) => { const end = performance.now() + ms; while (performance.now() < end) { if (test()) return true; await sleep(60); } return false; };
      press(btn);
      // Click ONCE. A slow chat may take a few seconds to clear the box, and a second click would send the message twice.
      const wentAway = () => !box.isConnected || boxText(box) !== textBefore || !isUsable(btn) || box.getAttribute("contenteditable") === "false" || box.readOnly;
      let went = !textBefore || isSearchy(box) || await gone(4000, wentAway); // a search form navigates away
      pushUndo({ kind: "irreversible", label: "a message that was sent" });
      if (!went) return say("Pressed Send, but the text is still in the box. It may not have sent; I did not press it again, to avoid sending twice");
      return say(text != null ? `${done}: "${text}"`.slice(0, 70) : done);
    }
    // No usable button: submit the form if there is one, else press Enter and check that the box emptied (the usual sign
    // that a message went). Never report success without that sign.
    const form = box.closest("form");
    if (form && !btn) { form.requestSubmit ? form.requestSubmit() : form.submit(); return say(done); }
    pressEnter(box);
    await sleep(400);
    if (!box.isConnected || boxText(box) !== hadText) { pushUndo({ kind: "irreversible", label: "a message that was sent" }); return say(`${done} (pressed Enter)`); }
    return say(btn ? `The "${labelOf(btn) || "Send"}" button didn't become clickable` : "Couldn't find a send button");
  }

  const mediaEls = () => [...document.querySelectorAll("video,audio")];
  function mediaAction(kind) {
    const m = mediaEls().find((e) => !e.paused) || mediaEls().find(isVisible) || mediaEls()[0];
    if (!m) return say("No video or audio found");
    if (kind === "pause") m.pause();
    else if (kind === "play") m.play().catch(() => say("Browser blocked playback"));
    else if (kind === "mute") m.muted = true;
    else if (kind === "unmute") m.muted = false;
    say({ pause: "Paused", play: "Playing", mute: "Muted", unmute: "Unmuted" }[kind]);
  }

  // "close": shut the topmost popup. Tries a native <dialog>, then a button labelled close/dismiss,
  // then the Escape key, which is what most custom popups listen for.
  function closeTopmost(back) {
    if (!cardEl.hidden) { hideCard(); return say("Closed"); }
    const dlg = [...document.querySelectorAll("dialog[open]")].pop();
    if (dlg) { dlg.close(); return say("Closed"); }
    scan();
    const popup = document.querySelector('[role=dialog]:not([hidden]),[role=alertdialog]:not([hidden]),[aria-modal=true]:not([hidden])');
    const btn = back && !(popup && popup.getClientRects().length) ? null : items.find(({ label }) => /^(close|dismiss)\b/i.test(label) || /^[×✕✖x]$/i.test(label));
    if (btn) { press(btn.el); return say(`Clicked "${btn.label}"`); }
    // an open email or conversation: its "Back to Inbox" button. "close the email" may use any back button; a plain "close" only
    // the ones that name a list, so it never walks you off a page.
    const backRe = back ? /^(?:back(?: to .+)?|go back|return(?: to .*)?|close (?:email|message|conversation|thread))$/i : /^back to (?:inbox|results|search results|list|messages|all)\b/i;
    const backBtn = items.find((it) => backRe.test(it.full.trim()) || (back && /^back to /i.test(it.full)));
    if (backBtn) { recordClick(backBtn.el, backBtn.label); press(backBtn.el); return say(`Clicked "${backBtn.label}"`); }
    if (back) { say("Going back"); pushUndo({ kind: "nav", reverse: "forward" }); return history.back(); } // "close the email" with no Back button
    const target = document.activeElement || document.body;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    }
    say("Pressed Escape");
  }

  // Risky clicks (buy, pay, delete...) wait for a spoken "yes".
  // Dropdowns: name it, then say the option you want ("sort by", then "price low to high").
  let lastSelect = null;
  function openSelect(el, label) {
    lastSelect = { el, at: Date.now() };
    el.focus();
    const options = [...el.options].map((o) => o.text.trim()).filter(Boolean);
    say(`${label || "Dropdown"}: ${options.slice(0, 6).join(", ")}${options.length > 6 ? "..." : ""}. Say the one you want`);
  }
  function chooseOption(el, phrase) {
    const p = norm(phrase);
    const best = [...el.options]
      .filter((o) => norm(o.text)) // "--" or "Choose..." placeholders that normalise to nothing are not options
      .map((o) => { const l = norm(o.text); return { o, sim: l === p ? 1 : ` ${l} `.includes(` ${p} `) || ` ${p} `.includes(` ${l} `) ? 0.9 : similarity(p, l) }; })
      .sort((a, b) => b.sim - a.sim)[0];
    if (!best || best.sim < 0.6) return false;
    pushUndo({ kind: "select", el, prev: el.value });
    el.value = best.o.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    say(`Selected "${best.o.text.trim()}"`);
    return true;
  }

  let pending = null, pendingTimer;
  function askFirst(label, fn) { // always ask, even if an earlier confirmation is still waiting
    pending = fn;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { if (pending) { pending = null; say("Confirmation timed out"); } }, 10000); // a stray "yes" later must not buy anything
    return say(`"${label}" - say "yes" to confirm or "cancel"`);
  }
  // ---------- an on-screen card: "what can I say?" and "read the results" ----------
  const cardEl = $("card");
  let cardTimer;
  function showCard(title, sections, ttl = 30000) {
    cardEl.replaceChildren(); // built from text nodes only: page text must never be able to inject markup into our UI
    const h = document.createElement("h2");
    h.textContent = title;
    cardEl.append(h);
    for (const s of sections) {
      if (s.heading) { const d = document.createElement("div"); d.className = "sub"; d.textContent = s.heading; cardEl.append(d); }
      const ul = document.createElement("ul");
      for (const line of s.lines) { const li = document.createElement("li"); li.textContent = line; ul.append(li); }
      cardEl.append(ul);
    }
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = 'Say "close" to hide this';
    cardEl.append(hint);
    cardEl.hidden = false;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(hideCard, ttl);
  }
  function hideCard() { cardEl.hidden = true; clearTimeout(cardTimer); }

  // What you can say right now: only the things this page can actually do
  function helpSections() {
    const out = [];
    out.push({ heading: "Moving around", lines: ['"scroll down", or "scroll down slowly" and then "stop"', '"go to the top" / "go to the bottom"', '"go back" / "go forward"'] });
    out.push({ heading: "Clicking", lines: ['"show numbers", then "click 5"', '"click" and the name, like "click sign in"'] });
    if (resultMarks().size > 0) {
      out.push({ heading: "This page has a list of results", lines: ['"open the second result"', '"open the cheapest one" / "the most expensive one"', '"I just want to see the third item"', '"read the results"'] });
    }
    if ([...document.querySelectorAll("select")].some((s) => s.getClientRects().length && /sort/i.test(`${fullLabel(s)} ${s.id} ${s.name}`))) {
      out.push({ heading: "Sorting", lines: ['"sort by price low to high"'] });
    }
    if (composerBox()) out.push({ heading: "Chat", lines: ['"type hello", then "send"', '"ask what is the weather" (types it and sends)'] });
    else if (searchBox()) out.push({ heading: "Search", lines: ['"search for headphones"'] });
    if (mediaEls().length) out.push({ heading: "Video and audio", lines: ['"pause", "play", "mute", "unmute"'] });
    const pack = typeof VoiceNavSites !== "undefined" ? VoiceNavSites.packFor(location.hostname) : null;
    if (pack && pack.tips.length) out.push({ heading: `On ${pack.name}`, lines: pack.tips });
    out.push({
      heading: "Tabs, other sites and the log",
      lines: [
        '"open youtube", "go to gmail in a new tab", "next tab", "switch to the second tab", "list tabs", "close this tab"',
        '"open the project and then chat": several steps in one sentence',
        '"speed 1.5", "skip 10 seconds", "like", "full screen", "open the mini player" (when a video is on the page)',
        '"scroll down the recent chats" / "scroll up the sidebar": one part of the page',
        '"search", then say what to look for',
        '"show failed commands" or "show the log": what worked and what did not, and where',
      ],
    });
    out.push({
      heading: "Settings and safety",
      lines: [
        '"undo" reverses your last action: typing, scrolling, a switch, or a page you opened',
        '"go to sleep" / "wake up", or "use wake word" so only "Nova ..." counts',
        lang === "hi-IN" ? '"speak English" to switch back' : '"Hindi mein bolo" for Hindi and Hinglish',
        '"move panel to the top left", "hide panel", "show panel"',
        "Buying, paying, deleting and subscribing always ask you to say yes first",
      ],
    });
    out.push({ heading: lang === "hi-IN" ? "Hindi examples" : "Hindi works too", lines: ['"neeche scroll karo", "doosra result kholo", "sabse sasta wala kholo", "peeche jao", "undo karo"'] });
    return out;
  }

  function readResults() {
    const rows = [...resultMarks()].map(([el, m]) => ({ el, ...m })).filter((r) => r.rank >= 0).sort((a, b) => a.rank - b.rank).slice(0, 8);
    if (!rows.length) return say('I don\'t see a list of results here. Say "show numbers" to number everything on screen');
    const lines = rows.map((r, i) => `${i + 1}. ${(labelOf(r.el) || "(no name)").slice(0, 80)}${r.price != null ? `   (${r.price})` : ""}${r.onscreen ? "" : "   (further down)"}`);
    showCard("Results on this page", [{ lines }]);
    say(`${rows.length} results. Say "open the second result"`);
  }

  // ---------- undo ----------
  // The last few things you did, newest last. Only what can really be reversed is undone; for the rest we say so plainly
  // instead of pretending ("I can't undo Add to cart" is better than silently doing nothing).
  const undoStack = [];
  function pushUndo(entry) {
    const stored = { ...entry, at: Date.now() };
    undoStack.push(stored);
    if (undoStack.length > 15) undoStack.shift();
    return stored; // callers that need to update the entry later must change THIS object, not their own copy
  }
  const rememberScroll = (target) => pushUndo({ kind: "scroll", target, top: target.scrollTop });

  const toggleState = (el) => el.checked ?? el.getAttribute("aria-checked") ?? el.getAttribute("aria-expanded") ?? el.getAttribute("aria-pressed") ?? (el.tagName === "SUMMARY" ? el.parentElement?.open : null);

  // A button that submits a form with POST (or any non-GET method) sends something somewhere: it can't be taken back
  function submitsData(el) {
    const form = el.closest("form");
    const isSubmit = el.matches("input[type=submit],input[type=image],button[type=submit]") || (el.tagName === "BUTTON" && !el.getAttribute("type") && !!form);
    return !!(isSubmit && form && (form.method || "get").toLowerCase() !== "get");
  }
  // Words that mean "this does something to your account or sends something"; we can't see what a site does behind a button
  const IRREVERSIBLE = /^(?:submit|post|publish|confirm|send|apply|pay|checkout|order|book|reserve|donate|register|sign ?up|delete|remove|cancel|unsubscribe)\b/i;

  // A click can toggle something (undo = click again), navigate (undo = go back), open a new tab (undo = close it), or be
  // something we can't take back (add to cart, buy, subscribe, submit...).
  function recordClick(el, label) {
    const entry = { kind: "click", label: label || el.tagName.toLowerCase(), url: location.href, navigated: false };
    if (el.matches('input[type=checkbox],[role=checkbox],[role=switch],summary,[aria-expanded],[aria-pressed]')) {
      entry.kind = "toggle"; entry.el = el; entry.before = toggleState(el);
    } else if (ACTION_BUTTON.test((label || "").toLowerCase()) || RISKY.test(label || "") || IRREVERSIBLE.test(label || "") || submitsData(el)) {
      entry.irreversible = true;
    }
    const stored = pushUndo(entry);
    // opensTab: only a link or form that targets a new window can open a tab; everything else that appears is the user's own
    const opensTab = !!el.closest('a[target="_blank"],area[target="_blank"],form[target="_blank"]');
    try { chrome.runtime.sendMessage({ type: "clickMade", url: location.href, label: stored.label, navigates: stored.kind === "click" && !stored.irreversible, opensTab }); } catch { /* the extension was reloaded */ }
    setTimeout(() => { if (stored.kind === "toggle") stored.after = toggleState(stored.el); }, 300);
    setTimeout(() => { if (location.href !== stored.url) stored.navigated = true; }, 1200);
  }

  // A click that loaded a whole new page, possibly on another site: the background worker knows which tab clicked what, so
  // this fresh page can learn it arrived by a click and "undo" can still go back
  try {
    chrome.runtime.sendMessage({ type: "arrivedByClick" }).then((r) => {
      // The reply arrives a moment after the page loads, so it may land after you have already done something here. It
      // describes the PAST (how you got to this page), so it goes at the bottom of the stack, never on top of newer actions.
      if (r && r.label) undoStack.unshift({ kind: "click", label: r.label, url: r.url, navigated: true, at: Date.now() });
    }).catch(() => {});
  } catch { /* the extension was reloaded */ }

  // Sites with their own Undo (Gmail's "Undo" after archive or delete, an editor's Undo button) know best how to reverse
  // what you did there, so pressing theirs beats guessing
  function pageUndoButton() {
    scan();
    return items.find((it) => /^undo\b/i.test(it.label) && !host.contains(it.el)) || null;
  }

  async function undo() {
    const own = pageUndoButton();
    if (own) { press(own.el); return say(`Pressed the page's own "${own.label}"`); }
    const e = undoStack.pop();
    if (!e || Date.now() - e.at > 10 * 60 * 1000) {
      // Nothing of ours to undo. If this tab was opened by a voice click, undoing means closing it and going back to where you were.
      let closed = false;
      try { closed = !!(await chrome.runtime.sendMessage({ type: "undoThisTab" }))?.closed; } catch { /* no background */ }
      if (closed) return;
      return say('Nothing to undo. To go back a page, say "go back"');
    }
    switch (e.kind) {
      case "scroll": {
        const t = e.target.isConnected ? e.target : document.scrollingElement;
        (t === document.scrollingElement ? window : t).scrollTo({ top: e.top, behavior: TEST_HOOK ? "instant" : "smooth" });
        return say("Scrolled back");
      }
      case "text":
        if (!e.el.isConnected) break;
        lastInserted = null;
        e.el.focus();
        setValue(e.el, e.prev);
        return say(e.prev ? "Put the earlier text back" : "Cleared what I typed");
      case "radio":
        if (!e.el.isConnected) break;
        wanted.delete(e.el); // the pending "did it change?" check belongs to the choice we are taking back
        if (e.prev && e.prev.isConnected) { press(e.prev); return say(`Back to "${e.prevLabel}"`); }
        return say("A radio button can't be un-chosen. Pick another option");
      case "select":
        if (!e.el.isConnected) break;
        e.el.value = e.prev;
        e.el.dispatchEvent(new Event("input", { bubbles: true }));
        e.el.dispatchEvent(new Event("change", { bubbles: true }));
        return say("Changed it back");
      case "toggle":
        if (!e.el.isConnected) break;
        wanted.delete(e.el);
        if (e.after !== undefined && e.after === e.before) return say(`Clicking "${e.label}" didn't change anything I can see, so there is nothing to undo`);
        // only flip it back if it is still the way the click left it; if the page changed it since, clicking would undo the wrong thing
        if (e.after !== undefined && toggleState(e.el) !== e.after) return say(`"${e.label}" has changed since, so I left it alone`);
        press(e.el);
        return say(`Switched "${e.label}" back`);
      case "nav":
        say(e.reverse === "back" ? "Going back" : "Going forward");
        return history[e.reverse]();
      case "click": {
        if (e.irreversible) return say(`I can't undo "${e.label}". It may have sent or changed something on the site`);
        let closed = false;
        try { closed = !!(await chrome.runtime.sendMessage({ type: "undoNewTab", clickAt: e.at }))?.closed; } catch { /* no background */ }
        if (closed) return say("Closed the page that opened");
        if (e.navigated || location.href !== e.url) { say("Going back"); return history.back(); }
        return say(`Clicking "${e.label}" didn't visibly change anything, so I can't tell what to undo`);
      }
      case "irreversible": return say(`I can't undo ${e.label}`);
    }
    say("I can't undo that any more");
  }

  // A synthetic click can't open a popup (browsers need a real key press or click for that), so the share buttons in a
  // share dialog (WhatsApp, Facebook...) "worked" but opened nothing. Build the network's own share link and open it as a tab.
  const SHARE_NETS = [
    [/^whats ?app\b/, "WhatsApp", (u, t) => `https://wa.me/?text=${encodeURIComponent(t + " " + u)}`],
    [/^facebook\b/, "Facebook", (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`],
    [/^(?:twitter|x)\b/, "X", (u, t) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`],
    [/^reddit\b/, "Reddit", (u, t) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}`],
    [/^telegram\b/, "Telegram", (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`],
    [/^linkedin\b/, "LinkedIn", (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`],
    [/^(?:email|e mail|gmail)\b/, "Email", (u, t) => `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(t)}&body=${encodeURIComponent(u)}`],
  ];
  function shareUrl() {
    const id = location.hostname.endsWith("youtube.com") && new URLSearchParams(location.search).get("v");
    return id ? `https://youtu.be/${id}` : (document.querySelector("link[rel=canonical]")?.href || location.href);
  }
  function tryShare(el, label) {
    const dlg = el.closest('[role=dialog],tp-yt-paper-dialog,ytd-unified-share-panel-renderer,yt-share-target-renderer');
    if (!dlg || !/\bshare\b/i.test(dlg.textContent.slice(0, 400))) return false;
    const net = SHARE_NETS.find(([re]) => re.test(norm(label)));
    if (!net) return false;
    recordClick(el, label);
    tabOp({ op: "new", url: net[2](shareUrl(), document.title.replace(/ - YouTube$/, "")), name: `${net[1]} share` });
    return true;
  }

  // ---- a visible pointer: shows where VoiceNav is clicking ----
  let cursorTimer = 0, cursorAt = null;
  function showCursor(x, y) {
    const c = root.getElementById("cursor");
    if (!c) return;
    if (!cursorAt) { c.style.transition = "none"; c.style.transform = `translate(${x}px,${y}px)`; void c.offsetWidth; c.style.transition = ""; } // first use: appear in place
    c.classList.add("show");
    c.style.transform = `translate(${x}px,${y}px)`;
    cursorAt = { x, y };
    const rip = document.createElement("div");
    rip.className = "ripple"; rip.style.left = x + "px"; rip.style.top = y + "px";
    root.appendChild(rip); setTimeout(() => rip.remove(), 600);
    clearTimeout(cursorTimer); cursorTimer = setTimeout(() => { c.classList.remove("show"); cursorAt = null; }, 1800);
  }

  // ---- real clicks, as a fallback ----
  // Scripted events are marked "not from a user", and some pages (and every popup) ignore them. When a click changed nothing
  // that can be seen, a genuine mouse press is sent through the browser's debugger. Only when it is safe: never for a link
  // (the page navigates itself), a text box, or anything that buys, sends, deletes or subscribes (a second press could do it twice).
  let trustedClicks = true;
  try {
    chrome.storage.local.get("trustedClicks").then((o) => { if (o.trustedClicks === false) trustedClicks = false; });
    chrome.storage.onChanged.addListener((ch) => { if (ch.trustedClicks) trustedClicks = ch.trustedClicks.newValue !== false; });
  } catch { /* no storage */ }

  // Start watching BEFORE the click is sent (the page can react instantly); resolves after a moment with whether anything changed.
  function watchForChange(el) {
    const startUrl = location.href, startFocus = document.activeElement;
    return new Promise((resolve) => {
      let changed = false;
      const mo = new MutationObserver((list) => { if (list.some((m) => m.target !== host && !host.contains(m.target))) changed = true; });
      mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      const onVis = () => { changed = true; };
      document.addEventListener("visibilitychange", onVis);
      setTimeout(() => {
        mo.takeRecords().forEach((m) => { if (m.target !== host && !host.contains(m.target)) changed = true; });
        mo.disconnect(); document.removeEventListener("visibilitychange", onVis);
        const a = document.activeElement; // pressing focuses the element itself; focus moving anywhere else means the page reacted
        resolve(changed || location.href !== startUrl || !el.isConnected || (a !== el && a !== startFocus));
      }, 450);
    });
  }

  const pressLabel = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60);
  // Never for a link (the page navigates itself), a text box, or anything that buys, sends, deletes or subscribes
  const realClickAllowed = (el) => {
    const label = pressLabel(el);
    return trustedClicks && !el.matches?.('a[href],input,select,textarea,summary,label,[contenteditable]') &&
      !(ACTION_BUTTON.test(label.toLowerCase()) || RISKY.test(label) || IRREVERSIBLE.test(label));
  };
  // Buttons that open a menu or popup are the ones that most often need a genuine press, and "nothing changed" is a strong
  // signal for them. For any other button a scripted click can work invisibly, so it is only repeated if the user asks again.
  const opensSomething = (el) => !!el.closest?.('[aria-haspopup]:not([aria-haspopup=false]),[aria-expanded=false]');

  function topElementAt(x, y) {
    let n = document.elementFromPoint(x, y);
    while (n?.shadowRoot?.elementFromPoint) { const inner = n.shadowRoot.elementFromPoint(x, y); if (!inner || inner === n) break; n = inner; }
    return n;
  }
  async function realClick(el, x, y, announce = true) {
    const why = (w) => { if (TEST_HOOK) host.dataset.realWhy = w; return false; };
    if (!el.isConnected || document.hidden) return why("detached or hidden");
    const top = topElementAt(x, y);
    if (!top || !(el === top || el.contains(top) || top.contains(el))) return why(`covered by ${top?.tagName}#${top?.id || ""}`); // something else is on top: a real press would hit that
    try {
      const r = await chrome.runtime.sendMessage({ type: "trustedClick", x, y });
      if (TEST_HOOK) host.dataset.trusted = String(+(host.dataset.trusted || 0) + 1);
      if (r && r.ok) { if (announce) say(`Clicked "${pressLabel(el) || el.tagName.toLowerCase()}" (real click)`); return true; }
    } catch { /* background unavailable */ }
    return false;
  }
  async function maybeTrustedClick(el, x, y, watch) {
    if (!realClickAllowed(el) || !opensSomething(el)) return;
    if (await watch) return;
    realClick(el, x, y);
  }
  let lastPress = { el: null, at: 0 };

  // A person's click is: pointer moves over, button goes down, button comes up, click. Many sites (menus, custom buttons,
  // Google's apps) react to the press and release and ignore a bare click event, so send the whole sequence, aimed at the
  // middle of the element. The final click is the element's own .click() so links, checkboxes and forms behave natively
  // (Google Docs draws its own buttons and needs the click event dispatched with the others).
  function press(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    showCursor(x, y);
    // The same thing asked for again within a few seconds means the first press did nothing: press it for real this time.
    // If a real press isn't possible (something is on top of it), fall back to the scripted one rather than lose the click.
    // (A toggle shows its own state, and pressing it twice on purpose is normal, so toggles never count as a retry.)
    const isToggle = el.matches?.('[aria-checked],[aria-pressed],[role=checkbox],[role=switch],[role=radio]');
    const retry = !isToggle && lastPress.el === el && Date.now() - lastPress.at < 15000 && realClickAllowed(el);
    lastPress = { el, at: Date.now() };
    if (retry) { realClick(el, x, y, false).then((ok) => { if (!ok) scriptedPress(el, x, y); }); return; }
    const watch = trustedClicks && opensSomething(el) ? watchForChange(el) : null;
    scriptedPress(el, x, y);
    if (watch) maybeTrustedClick(el, x, y, watch);
  }
  function scriptedPress(el, x, y) {
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    const fire = (Type, name, extra) => { try { el.dispatchEvent(new Type(name, { ...o, ...extra })); } catch { /* an old engine without PointerEvent */ } };
    fire(PointerEvent, "pointerover"); fire(MouseEvent, "mouseover");
    fire(PointerEvent, "pointerdown", { buttons: 1 }); fire(MouseEvent, "mousedown", { buttons: 1 });
    if (!el.matches?.(TEXTY) && typeof el.focus === "function") try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    fire(PointerEvent, "pointerup"); fire(MouseEvent, "mouseup");
    if (/(^|\.)docs\.google\.com$/.test(location.hostname)) fire(MouseEvent, "click"); else el.click();
  }

  function doClick(item, list = items) {
    const { el, label } = item;
    // test-only dry run: say what would be pressed, press nothing (for looking at real sites without touching anything)
    if (TEST_HOOK && host.dataset.dry === "1") { host.dataset.would = label; return say(`Would click: ${label}`); }
    if (RISKY.test(label)) return askFirst(label, () => { recordClick(el, label); press(el); say(`Clicked "${label}"`); });
    if (el.tagName === "SELECT") return openSelect(el, label);
    if (tryShare(el, label)) return;
    el.scrollIntoView({ block: "center", behavior: TEST_HOOK ? "instant" : "smooth" });
    if (el.matches(TEXTY + ",select")) el.focus(); else { recordClick(el, label); press(el); }
    say(`Clicked ${list.indexOf(item) + 1}: ${label || el.tagName.toLowerCase()}`.slice(0, 70));
  }

  // Similarity of two strings from 0 to 1 (Dice coefficient on letter pairs), to forgive mishearings like "card" for "cart".
  function similarity(a, b) {
    const pairs = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const pa = pairs(a), pb = pairs(b);
    let hit = 0;
    for (const [p, n] of pa) hit += Math.min(n, pb.get(p) || 0);
    return (2 * hit) / (a.length - 1 + b.length - 1);
  }
  function fuzzyScore(p, label) {
    const words = p.split(" ").length;
    const head = label.split(" ").slice(0, words + 1).join(" "); // long labels: compare the start only
    return Math.max(similarity(p, label), similarity(p, head));
  }

  // Buttons that do something to an item rather than open it. "Open the orange" must never press "Add to cart, Orange".
  const ACTION_BUTTON = /^(?:add|buy|subscribe|save|follow|remove|delete|place)\b/;

  // Returns false when nothing matched, so the caller can fall back to the AI.
  // `navigate` is true for "open ..." / "go to ...": those only match things you can follow, not action buttons.
  // Compare words, not punctuation: "How long does it take to learn Python?" should match "how long does it take to learn python"
  // "&" is read as "and", so the label "Snacks & treats" matches what people say: "snacks and treats"
  const norm = (str) => str.toLowerCase().replace(/\s*&\s*/g, " and ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  const LOOSE_FILLER = new Set(["email", "mail", "message", "from", "about", "with", "regarding", "the", "a", "an", "of", "chat", "conversation", "thread", "video", "post", "named", "called", "titled", "one"]);
  function clickByText(phrase, navigate = false) {
    scan();
    for (const el of resultMarks().keys()) itemIndex(el); // results below the fold can be named too; clicking scrolls to them
    const p = norm(phrase);
    const pool = items.filter((it) => !(navigate && (ACTION_BUTTON.test(it.label.toLowerCase()) || /^(?:checkbox|radio|switch)$/.test(roleOf(it.el)))));
    const hasWords = (hay, needle) => (" " + hay + " ").includes(" " + needle + " "); // whole words: "art" is not in "cart"
    let scored = pool
      .map((it) => ({ it, l: norm(it.full || it.label) }))
      .filter(({ l }) => l && hasWords(l, p))
      .map((x) => ({ ...x, score: x.l === p ? 0 : x.l.startsWith(p + " ") ? 1 : 2 }))
      .sort((a, b) => a.score - b.score || (a.it.offscreen ? 1 : 0) - (b.it.offscreen ? 1 : 0) || a.l.length - b.l.length);
    if (!scored.length) {
      // "the email from Rahul", "the chat about recipe ideas": leave out the filler words and match the rest, in any order
      const content = p.split(" ").filter((w) => w && !LOOSE_FILLER.has(w));
      if (content.length && content.length < p.split(" ").length) {
        const cp = content.join(" ");
        scored = pool.map((it) => ({ it, l: norm(it.full || it.label) }))
          .filter(({ l }) => l && content.every((w) => hasWords(l, w)))
          .map((x) => ({ ...x, score: x.l === cp ? 0 : x.l.startsWith(cp + " ") ? 1 : 2 }))
          .sort((x, y) => x.score - y.score || (x.it.offscreen ? 1 : 0) - (y.it.offscreen ? 1 : 0) || x.l.length - y.l.length);
      }
    }
    if (!scored.length && typeof VoiceNavSites !== "undefined") {
      // A command pack for this site ("the three dots" on YouTube, "file" in Docs): the page's labels matched nothing
      const al = VoiceNavSites.aliasFor(location.hostname, p);
      if (al) {
        let found = [];
        try { found = queryDeep(al.selector).filter((e) => !host.contains(e) && isVisible(e)); } catch { /* a bad selector in a pack */ }
        if (found.length) { doClick({ el: found[0], label: al.label || pressLabel(found[0]) }); return true; }
      }
    }
    if (!scored.length) {
      // The icon has no words on it ("plus", "mic", "search"): go by what the site calls it in its code, and by synonyms
      const byHint = hintMatches(pool, p);
      // YouTube: every comment and recommended video has its own "More actions"; "the three dots" means the video's
      const own = location.hostname.endsWith("youtube.com") ? byHint.filter((x) => x.it.el.closest("ytd-watch-metadata,#above-the-fold")) : [];
      if (byHint.length > 1 && own.length === 1) { doClick(own[0].it); return true; }
      if (byHint.length === 1) { doClick(byHint[0].it); return true; }
      if (byHint.length > 1) {
        numbersOn = true; drawBadges();
        say(`${byHint.length} matches. Say "click" and a number`);
        return true;
      }
    }
    if (!scored.length) {
      // No exact phrase on the page: accept a close spelling if it's clearly the best one
      const near = pool
        .map((it) => ({ it, l: norm(it.label), sim: it.label ? fuzzyScore(p, norm(it.label)) : 0 }))
        .filter((x) => x.sim >= 0.85)  // close spellings only: word order or a different model number is a different product
        .sort((a, b) => b.sim - a.sim);
      if (!near.length) return false;
      scored = [{ ...near[0], score: 3 }];
    }
    // In a chain ("open the project and then chat"), a match that only appeared after the first step is the one meant
    if (preferNew) { const fresh = scored.filter((x) => !preferNew.has(x.it.el)); if (fresh.length) scored = fresh; }
    // Several equally good matches: ask, unless they're all links to the same place (an image and a title for one product).
    // Twenty identical "Add to cart" buttons are NOT the same place, so those ask instead of silently picking the first.
    // Only compare like with like: a match you can see beats one further down the page
    const tied = scored.filter((x) => x.score === scored[0].score && !!x.it.offscreen === !!scored[0].it.offscreen);
    const samePlace = tied.every((x) => x.it.el.tagName === "A" && x.it.el.href && x.it.el.href === tied[0].it.el.href) ||
      // opening a product by name: the same title listed twice (organic and sponsored) is one product, so take the first
      (navigate && tied.every((x) => x.it.el.tagName === "A" && x.l === tied[0].l)) ||
      // matches that are all below the fold can't be numbered on screen, so asking would be pointless: take the first
      tied.every((x) => x.it.offscreen);
    if (tied.length > 1 && !samePlace) {
      numbersOn = true; drawBadges();
      say(`${tied.length} matches. Say "click" and a number`);
      return true;
    }
    doClick(scored[0].it);
    // Several different products matched below the fold and we took the first: say so, so a wrong guess is easy to notice
    if (tied.length > 1 && tied.every((x) => x.it.offscreen) && !tied.every((x) => x.l === tied[0].l)) {
      say(`Opened the first of ${tied.length} matches: ${scored[0].it.label}`.slice(0, 80));
    }
    return true;
  }

  // ---------- forms and dictation ----------
  // Fields are found by the name a person would give them (their label, placeholder or aria-label), never by position, so
  // "fill name with Asha" works on a form VoiceNav has never seen. What gets typed is turned into text by forms.js.
  const F = VoiceNavForms;
  const FIELD_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]),textarea,select,[contenteditable=true],[contenteditable=""],[role=checkbox],[role=switch],[role=radio]';
  const UNSUPPORTED_TYPES = /^(?:time|datetime-local|month|week)$/;
  let lastField = null;     // the field you were last in (focus drops to the page when you click elsewhere)
  let lastInserted = null;  // the undo entry of the last thing typed, for "delete that"
  let lastRepeat = null;    // the last command that makes sense to say again: next field, an edit, a scroll
  const REPEATABLE = new Set(["nextField", "edit", "scroll", "mediaSeek"]);
  addEventListener("focusin", (e) => {
    const t = e.target;
    if (t && t !== host && t.matches?.(FIELD_SEL)) lastField = t;
  }, true);

  function fieldKind(el) {
    const role = el.getAttribute("role");
    if (el.tagName === "SELECT") return "select";
    if (role === "checkbox" || role === "switch" || el.type === "checkbox") return "checkbox";
    if (role === "radio" || el.type === "radio") return "radio";
    return "text";
  }
  const secret = (el) => el.type === "password" || /password/.test(el.getAttribute("autocomplete") || "");
  const isOn = (el) => (el.type === "checkbox" || el.type === "radio" ? el.checked : el.getAttribute("aria-checked") === "true");

  // Fields you can really fill: rendered, enabled, on the page (not a hidden spam-trap field parked off-screen)
  function usable(el) {
    if (host.contains(el) || el.disabled || el.getAttribute("aria-disabled") === "true" || el.readOnly) return false;
    if (el.closest("[inert],[hidden],[aria-hidden=true]") || UNSUPPORTED_TYPES.test(el.type || "")) return false;
    const r = el.getBoundingClientRect();
    if (!el.getClientRects().length) return false;
    const pageW = document.documentElement.scrollWidth;
    if (r.right < 0 || r.left > pageW) return false; // parked off to the side
    const kind = fieldKind(el), cs = getComputedStyle(el);
    if (cs.visibility === "hidden") return false;
    if (r.bottom + scrollY < 0 || r.right + scrollX < 0) return false; // parked above or left of the page
    if (/rect\(0(?:px)?,? ?0(?:px)?,? ?0(?:px)?,? ?0(?:px)?\)|inset\(100%|inset\(50%/.test(`${cs.clip} ${cs.clipPath}`)) return false; // clipped to nothing
    // a field inside something transparent is as invisible as one that is transparent itself
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a).opacity === "0") return false;
    if (kind === "text" || kind === "select") return r.width >= 8 && r.height >= 8 && cs.opacity !== "0";
    return true; // styled checkboxes are often a tiny or transparent input over a drawn box
  }
  const formFields = () => [...document.querySelectorAll(FIELD_SEL)].filter(usable);
  // radio buttons of one group are one stop when moving through a form
  function stops() {
    const seen = new Set();
    return formFields().filter((e) => {
      if (e.type !== "radio" || !e.name) return true;
      const key = `${e.name}|${e.form ? [...document.forms].indexOf(e.form) : -1}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ---- names ----
  const SYNONYMS = [
    [/\b(?:mobile|telephone|cell|tel)\b/g, "phone"], [/\be mail\b|\bmail\b/g, "email"],
    [/\b(?:pincode|postal code|postcode|pin code|zip code)\b/g, "zip"], [/\b(?:date of birth|birthday|birth date|birthdate)\b/g, "dob"],
    [/\b(?:surname|family name|lastname)\b/g, "last name"], [/\b(?:given name|firstname|fname)\b/g, "first name"], [/\b(?:full name|your name)\b/g, "name"],
  ];
  const STOP = new Set(["your", "my", "the", "please", "a", "an", "enter", "field", "box", "input"]);
  function canon(str) {
    let n = norm(str || "");
    for (const [re, to] of SYNONYMS) n = n.replace(re, to);
    const tokens = n.split(" ").filter((w) => w && !STOP.has(w));
    while (tokens.length > 1 && /^(?:number|no|details)$/.test(tokens[tokens.length - 1])) tokens.pop();
    return tokens;
  }
  function nameScore(p, n) {
    if (!p.length || !n.length) return 0;
    if (p.join(" ") === n.join(" ")) return 1;
    if (p.every((w) => n.includes(w))) return 0.85 + 0.1 * (p.length / n.length) + (n[0] === p[0] ? 0.04 : 0); // the first word names the field: "address" is "Address line 1", not "Email address"
    const sim = similarity(p.join(" "), n.join(" "));
    return sim >= 0.89 ? sim * 0.9 : 0;
  }
  // Every name this field goes by, best first
  // A label that wraps its control also contains the control's own text (a dropdown's options): leave that out
  function labelText(label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll("select,textarea,input,datalist,option,button").forEach((n) => n.remove());
    return copy.textContent;
  }
  function fieldNames(el, { aliases = true } = {}) {
    const out = [];
    const add = (s) => {
      const raw = String(s || "").replace(/[*:]/g, " ").replace(/\s+/g, " ").trim();
      const t = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      if (t && t.length < 120) out.push(t);
      if (raw !== t && raw.length < 120) out.push(raw.replace(/[()]/g, " ").replace(/\s+/g, " ").trim()); // "Dropdown (select)" is also "dropdown select"
    };
    add(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) add(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));
    if (el.labels) for (const l of el.labels) add(labelText(l));
    if (!el.labels?.length) { const wrap = el.closest("label"); if (wrap) add(labelText(wrap)); }
    if (fieldKind(el) !== "text" && fieldKind(el) !== "select" && el.tagName !== "INPUT") add((el.textContent || "").slice(0, 100));
    add(el.getAttribute("placeholder")); add(el.getAttribute("data-placeholder")); add(el.getAttribute("title"));
    if (!out.length) { const prev = el.previousElementSibling; if (prev && !prev.matches(FIELD_SEL)) add((prev.textContent || "").slice(0, 60)); }
    add(el.name); add(el.id); add(el.getAttribute("autocomplete"));
    if (aliases && ["email", "tel", "password", "date", "url", "number"].includes(el.type)) add({ tel: "phone" }[el.type] || el.type);
    return out;
  }
  const displayName = (el) => (fieldNames(el)[0] || el.type || el.tagName.toLowerCase()).slice(0, 40);
  // A radio button on its own is "Male"; as a stop in a form it is the question it answers, "Gender"
  function stopName(el) {
    if (fieldKind(el) !== "radio") return displayName(el);
    const g = el.closest("fieldset")?.querySelector("legend")?.textContent || el.closest("[role=radiogroup]")?.getAttribute("aria-label") || "";
    return (g.replace(/[*:]/g, " ").replace(/\s+/g, " ").trim() || (el.name || "").replace(/[_-]+/g, " ") || displayName(el)).slice(0, 40);
  }

  // The field called `phrase`: the best match, a list of names when two fields match equally well, or nothing
  function findField(phrase, kinds) {
    const p = canon(phrase);
    const scored = formFields().filter((e) => !kinds || kinds.includes(fieldKind(e)))
      // the kind of input ("email") only counts when no real label does: it must not tie "Email" with "Confirm email"
      .map((el) => {
        const labels = fieldNames(el, { aliases: false }), all = fieldNames(el);
        const best = (names) => Math.max(0, ...names.map((n) => nameScore(p, canon(n))));
        return { el, s: Math.max(best(labels), 0.85 * best(all.slice(labels.length))) };
      })
      .filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s);
    if (!scored.length) return { el: null };
    const top = scored.filter((x) => Math.abs(x.s - scored[0].s) < 0.001);
    if (top.length > 1) return { el: null, ambiguous: top.map((x) => displayName(x.el)) };
    return { el: scored[0].el, score: scored[0].s };
  }

  // ---- what a field holds ----
  function stateOf(el) {
    const kind = fieldKind(el);
    if (kind === "checkbox") return isOn(el) ? "ticked" : "not ticked";
    if (kind === "select") { const o = el.selectedOptions?.[0]; return o && o.value !== "" ? o.text.trim() : "nothing chosen"; }
    if (kind === "radio") {
      const group = el.name ? [...document.querySelectorAll("input[type=radio]")].filter((r) => r.name === el.name && r.form === el.form) : [el];
      const on = group.find((r) => r.checked);
      const labels = group.map((r) => fieldNames(r)[0]).filter(Boolean);
      return `${on ? `"${fieldNames(on)[0] || "chosen"}"` : "nothing chosen"} (options: ${labels.slice(0, 6).join(", ")})`;
    }
    const v = el.isContentEditable ? el.innerText.trim() : el.value || "";
    if (secret(el)) return v ? `hidden, ${v.length} characters` : "empty";
    return v ? `"${v.length > 40 ? v.slice(0, 40) + "..." : v}"` : "empty";
  }
  const requiredMark = (el) => (el.required || el.getAttribute("aria-required") === "true" ? " *" : "");

  const goTo = (el) => { el.scrollIntoView({ block: "center", behavior: TEST_HOOK ? "instant" : "smooth" }); el.focus?.({ preventScroll: true }); lastField = el; };

  function moveField(dir) {
    const list = stops();
    if (!list.length) return say("No form fields on this page");
    const a = document.activeElement;
    let i = list.findIndex((f) => f === a || f.contains(a));
    if (i < 0 && (!a || a === document.body) && lastField) i = list.indexOf(lastField);
    if (i < 0) i = dir > 0 ? -1 : list.length;
    const ni = i + dir;
    if (ni < 0 || ni >= list.length) return say(dir > 0 ? "That was the last field" : "That was the first field");
    const el = list[ni];
    goTo(el);
    say(`${ni + 1} of ${list.length}: ${stopName(el)}${requiredMark(el)}, ${stateOf(el)}`.slice(0, 120));
  }

  function listFields() {
    const list = stops();
    if (!list.length) return say("No form fields on this page");
    const lines = list.slice(0, 40).map((el, i) => `${i + 1}. ${stopName(el)}${requiredMark(el)}: ${stateOf(el)}`);
    if (list.length > 40) lines.push(`...and ${list.length - 40} more`);
    showCard(`${list.length} form field${list.length === 1 ? "" : "s"}`, [{ lines }, { heading: "Try", lines: ['"fill name with Asha"', '"tick the terms box"', '"next field"', '"read this field"'] }], 60000);
    say(`${list.length} fields`);
  }

  function readField() {
    const el = document.activeElement?.matches?.(FIELD_SEL) && !host.contains(document.activeElement) ? document.activeElement : lastField;
    if (!el || !el.isConnected) return say('No field selected. Say "next field"');
    say(`${stopName(el)}: ${stateOf(el)}`.slice(0, 120));
  }

  // ---- writing into fields ----
  const PHONEISH = /\b(?:phone|otp|zip|postal)\b/;
  function interpret(el, value) {
    const type = (el.type || "").toLowerCase();
    const hay = fieldNames(el).map((n) => canon(n).join(" ")).join(" | ");
    if (type === "email" || /\bemail\b/.test(hay)) {
      const e = F.spokenEmail(value);
      if (e) return { value: e };
      if (/@/.test(value)) return { value: value.replace(/\s+/g, "") };
      if (type === "email") return { error: `That doesn't sound like an email address. Say it like "asha at gmail dot com"` };
      return { value };
    }
    if (type === "date") {
      const d = F.parseSpokenDate(value);
      return d ? { value: d } : { error: 'Say the date like "5th of March 1999"' };
    }
    if (type === "tel" || type === "number" || PHONEISH.test(hay)) {
      if (type === "number" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return { value: value.trim() };
      if (/^\+?[\d\s\-()]+$/.test(value.trim())) return { value: value.trim().replace(/[\s\-()]/g, "") };
      const d = F.spokenDigits(value);
      if (d) return { value: d };
      if (type === "tel" || type === "number") return { error: `I couldn't hear "${value}" as a number` };
    }
    return { value };
  }

  // Types `value` into a text box, with undo. Says what happened; returns whether it worked.
  function writeText(el, value, name = displayName(el)) {
    el.scrollIntoView({ block: "center", behavior: TEST_HOOK ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
    // a script setting .value ignores maxlength; a keyboard would stop typing there, so do the same and say so
    const cut = el.maxLength > 0 && value.length > el.maxLength;
    if (cut) value = value.slice(0, el.maxLength);
    const entry = pushUndo({ kind: "text", el, prev: rawText(el) });
    if (!setValue(el, value)) {
      undoStack.splice(undoStack.indexOf(entry), 1);
      say(`Couldn't fill "${name}"`);
      return false;
    }
    markInserted(entry, el);
    if (secret(el)) { say(`${name}: filled (hidden)${cut ? `, but it only holds ${el.maxLength} characters` : ""}`); return true; }
    if (cut) { say(`${name} only holds ${el.maxLength} characters: "${value}"`); return true; }
    const shown = el.isContentEditable ? el.innerText.trim() : el.value;
    if (value && shown !== value) say(`${name}: the page shows "${shown}"`.slice(0, 120)); // a limit or a formatting script changed what was typed
    else say(value ? `${name}: ${value}`.slice(0, 100) : `Cleared ${name}`);
    return true;
  }

  function setChecked(el, on) {
    const name = displayName(el), kind = fieldKind(el);
    if (kind === "radio" && !on) return say("A radio button can't be switched off. Pick another option of that group");
    if (isOn(el) === on) return say(`"${name}" is already ${on ? "ticked" : "not ticked"}`);
    el.scrollIntoView({ block: "center", behavior: TEST_HOOK ? "instant" : "smooth" });
    if (kind === "radio") {
      const prev = el.name ? [...document.querySelectorAll("input[type=radio]")].find((r) => r.name === el.name && r.form === el.form && r.checked && r !== el) : null;
      pushUndo({ kind: "radio", el, prev, prevLabel: prev ? fieldNames(prev)[0] : "" });
    } else recordClick(el, name);
    press(el);
    lastField = el;
    wanted.set(el, on);
    // some pages control their own switches; say so rather than claim success (unless you have asked for the opposite since)
    setTimeout(() => { if (wanted.get(el) === on && isOn(el) !== on) sayLate(`"${name}" didn't change. The page may control it itself`); }, 250);
    return say(`${on ? "Ticked" : "Unticked"} "${name}"`);
  }

  const wanted = new WeakMap();
  const YES = /^(?:on|yes|true|ticked|checked|tick|enabled?|haan?|chalu)$/i, NO = /^(?:off|no|false|unticked|unchecked|untick|disabled?|nahi|band)$/i;
  // "fill gender with female": no field is called gender, but a group of radio buttons is
  function chooseRadio(fieldPhrase, valuePhrase) {
    const fp = canon(fieldPhrase), vp = canon(valuePhrase);
    const hit = formFields().filter((e) => fieldKind(e) === "radio").find((r) => {
      const groupNames = [r.closest("fieldset")?.querySelector("legend")?.textContent, r.name,
        r.closest("[role=radiogroup]")?.getAttribute("aria-label"),
        (r.closest("[role=radiogroup]")?.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")].filter(Boolean);
      return groupNames.some((g) => nameScore(fp, canon(g)) >= 0.8) && fieldNames(r).some((n) => nameScore(vp, canon(n)) >= 0.85);
    });
    return hit ? (setChecked(hit, true), true) : false;
  }

  // `soft` commands ("set the volume to 50", "clear notifications") are everyday speech: with no such field they go to the AI instead
  function fillByName(field, value, cmd = {}) {
    if (chooseRadio(field, value)) return;
    const r = findField(field, null);
    if (r.ambiguous) return say(`More than one field matches "${field}": ${r.ambiguous.slice(0, 3).join(", ")}. Be more specific`);
    if (!r.el) return cmd.soft ? askAI(cmd.heard) : say(`No field called "${field}". Say "list fields"`);
    const el = r.el, kind = fieldKind(el), v = value.trim();
    if (kind === "checkbox" || kind === "radio") {
      if (YES.test(v)) return setChecked(el, true);
      if (NO.test(v)) return setChecked(el, false);
      return say(`Say "tick ${field}" or "untick ${field}"`);
    }
    if (kind === "select") {
      goTo(el);
      return chooseOption(el, value) ? (lastField = el, undefined) : say(`No option like "${value}" in ${displayName(el)}`);
    }
    const out = interpret(el, value);
    if (out.error) return say(out.error);
    return void writeText(el, out.value);
  }

  const GENERIC_BOX = /^(?:text ?box|box|field|input|here|this|message(?: box)?|chat(?: box)?|prompt|search(?: box| bar| field)?)$/;
  function typeInto(box, text) {
    box.focus();
    const entry = pushUndo({ kind: "text", el: box, prev: rawText(box) });
    if (!setValue(box, text)) return say("Couldn't type into that box");
    markInserted(entry, box);
    return say(secret(box) ? "Typed (hidden)" : `Typed "${text}"`);
  }
  // "type Asha in name": into the field called name if the page has one; otherwise it was ordinary text that happens to contain "in"
  function fillOrType(cmd) {
    const generic = norm(cmd.field);
    if (GENERIC_BOX.test(generic)) {
      const box = /^search/.test(generic) ? searchBox() : /^(?:message|chat|prompt)/.test(generic) ? composerBox() : typeTarget();
      return box ? typeInto(box, cmd.value) : say("No text box found");
    }
    const r = findField(cmd.field, ["text", "select"]);
    if (r.ambiguous) return say(`More than one field matches "${cmd.field}": ${r.ambiguous.slice(0, 3).join(", ")}. Be more specific`);
    if (r.el && (r.score >= 0.95 || (cmd.strict && r.score >= 0.85))) return fillByName(cmd.field, cmd.value);
    // "put" is everyday speech ("put this in my cart for later"): with no such field it is not a typing command at all
    if (cmd.strict) return askAI(cmd.heard);
    return execute({ type: "type", text: cmd.text });
  }

  function checkByName(field, on, hint) {
    // "the default checkbox" is not "the default radio button": the word you said narrows it down
    const r = findField(field, hint === "checkbox" ? ["checkbox"] : ["checkbox", "radio"]);
    if (r.ambiguous) return say(`More than one box matches "${field}": ${r.ambiguous.slice(0, 3).join(", ")}. Be more specific`);
    if (!r.el) return say(`No checkbox called "${field}". Say "list fields"`);
    return setChecked(r.el, on);
  }

  // "type number nine eight ...", "type email asha at gmail dot com", "type date 5 march 1999": into the box you are in
  function typeSpecial(kind, spoken, full) {
    const a = document.activeElement;
    const el = a && a.matches?.(FIELD_SEL) && !host.contains(a) && fieldKind(a) === "text" ? a : editTarget();
    if (!el) return say("No text box found. Click one first");
    let value;
    // "write email to my boss asking for leave" is a sentence, not an address: when it doesn't parse, type the words
    const plain = () => execute({ type: "type", text: full || spoken });
    if (kind === "number") {
      value = /^-?\d+(?:\.\d+)?$/.test(spoken.trim()) ? spoken.trim() : F.spokenDigits(spoken);
      if (!value) return plain();
    } else if (kind === "email") {
      value = F.spokenEmail(spoken);
      if (!value) return /\b(?:at|dot)\b/i.test(spoken) ? say(`That doesn't sound like an email address. Say it like "asha at gmail dot com"`) : plain();
    } else {
      const d = F.parseSpokenDate(spoken);
      if (!d) return plain();
      value = el.type === "date" ? d : d.split("-").reverse().join("/"); // a plain text box gets DD/MM/YYYY
    }
    writeText(el, value);
  }

  // ---- editing the box you are in ----
  function editTarget() {
    const a = document.activeElement;
    if (a && a.matches?.(TEXTY) && !host.contains(a)) return a;
    if (lastField && lastField.isConnected && lastField.matches?.(TEXTY)) return lastField;
    return typeTarget();
  }
  const rawText = (el) => (el.isContentEditable ? el.innerText.replace(/^\n$/, "") : el.value || "");

  // Adds text at the end of a box, the way typing would (so rich editors notice it)
  function appendText(el, piece) {
    if (el.isContentEditable) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const before = el.innerText;
      piece.split("\n").forEach((part, i) => {
        if (i > 0) document.execCommand("insertLineBreak");
        if (part) document.execCommand("insertText", false, part);
      });
      return el.innerText !== before;
    }
    return setValue(el, (el.value || "") + piece);
  }

  // Remember what was typed (and what the box held right after), so "delete that" never touches anything else
  function markInserted(entry, el) {
    entry.after = rawText(el);
    lastInserted = entry; lastField = el;
  }
  function deleteThat() {
    const e = lastInserted;
    if (!e || !e.el.isConnected) return say("Nothing to delete");
    if (rawText(e.el) !== e.after) { lastInserted = null; return say("The box has changed since, so I left it alone"); }
    const i = undoStack.indexOf(e);
    if (i >= 0) undoStack.splice(i, 1);
    e.el.focus();
    setValue(e.el, e.prev);
    const top = undoStack[undoStack.length - 1];
    lastInserted = top && top.kind === "text" ? top : null;
    return say("Deleted what I just typed");
  }

  function editBox(op, cmd = {}) {
    // "delete this" / "select all" are everyday phrases: outside a text box they are not edits
    const inBox = dictating || (document.activeElement?.matches?.(TEXTY) && !host.contains(document.activeElement));
    if (!inBox && op === "deleteThat") return cmd.heard ? askAI(cmd.heard) : say("Click a text box first");
    if (!inBox && op === "selectAll") return clickByText("select all") || say("Click a text box first, then say select all");
    if (op === "deleteThat") return deleteThat();
    const el = editTarget();
    if (!el) return say("No text box to edit. Click one first");
    const cur = rawText(el);
    if (op === "selectAll") {
      el.focus();
      if (el.select) el.select(); else document.execCommand("selectAll");
      return say("Selected all the text");
    }
    if (op === "newLine" || op === "newParagraph") {
      if (el.tagName === "INPUT") return say("This box is one line");
      el.focus();
      const entry = pushUndo({ kind: "text", el, prev: rawText(el) });
      appendText(el, op === "newLine" ? "\n" : "\n\n");
      markInserted(entry, el);
      return say(op === "newLine" ? "New line" : "New paragraph");
    }
    const next = op === "deleteWord" ? F.deleteLastWord(cur) : op === "deleteSentence" ? F.deleteLastSentence(cur) : [...cur].slice(0, -1).join("");
    if (next === cur || !cur) return say("Nothing to delete");
    el.focus();
    const entry = pushUndo({ kind: "text", el, prev: rawText(el) });
    setValue(el, next);
    return say(op === "deleteWord" ? "Deleted the last word" : op === "deleteSentence" ? "Deleted the last sentence" : "Deleted a character");
  }

  // ---- dictation: everything you say is typed, until you say "stop dictation" ----
  const DICTATION_CONTROLS = new Set(["dictate", "nextField", "edit", "undo", "clear", "readField", "listFields", "off", "attention", "lang", "hideCard", "numbers"]);
  function startDictation() {
    const el = editTarget();
    if (!el) return say('Click a text box first, then say "start dictation"');
    el.focus();
    dictating = { timer: null, el };
    dictBtn.hidden = false;
    resetDictationTimer();
    say('Dictating. Say "stop dictation" when you are done');
  }
  function stopDictation(message) {
    if (!dictating) return say("Not dictating");
    clearTimeout(dictating.timer);
    dictating = null;
    dictBtn.hidden = true;
    wake();
    say(message || "Dictation off");
  }
  // Dictation swallows every command, so it must not be left on by accident
  function resetDictationTimer() {
    clearTimeout(dictating.timer);
    dictating.timer = setTimeout(() => { if (dictating) stopDictation("Dictation stopped after 2 minutes of silence"); }, 120000);
  }
  function dictate(spoken) {
    // The box is the one you started in (or one you have clicked into since). If it is gone, stop rather than type elsewhere.
    const a = document.activeElement;
    if (a && a.matches?.(TEXTY) && !host.contains(a)) dictating.el = a;
    const el = dictating.el;
    if (!el || !el.isConnected || !usable(el)) return stopDictation("Dictation stopped: the text box is gone");
    resetDictationTimer();
    let piece = secret(el) ? spoken.trim() : F.formatDictation(spoken, rawText(el)); // a password is typed exactly as said
    if (el.tagName === "INPUT") piece = piece.replace(/\n+/g, " ").replace(/ {2,}/g, " "); // a one-line box has no new lines
    if (!piece) return;
    el.focus();
    const entry = pushUndo({ kind: "text", el, prev: rawText(el) });
    if (!appendText(el, piece)) {
      undoStack.splice(undoStack.indexOf(entry), 1);
      return say("Couldn't type into that box");
    }
    markInserted(entry, el);
    say(secret(el) ? "Typed (hidden)" : `Typed: ${piece.trim()}`.slice(0, 70));
  }

  // ---------- the voice log: what worked and what didn't, and on which site ----------
  // Every command is written down with its result, so failures can be read later (options page: say "show the log", or the
  // extension's Options). Kept on this computer only. What you typed or dictated is not stored, only that you did.
  let cmdCtx = null;      // the command being handled: its messages, what it parsed to, how it was understood
  let lastLogged = null;  // the newest log entry, so a warning that arrives a moment later can still mark it as failed
  const FAIL_MSG = /^(?:no |not |nothing |couldn|can'?t|cannot|didn'?t|doesn'?t|unable|more than|the ai |ai backend|extension was|that doesn|i couldn|i can'?t|click a text box|dictation stopped|the box has changed|the page |clicking "|pressed [a-z ]+, but|stopped:|browser blocked|too long|there is no |there's no |tab \d+ is a browser|clicked "[^"]*", but|the browser wouldn|already as (?:fast|slow))/i;
  const OK_MSG = /^(?:nothing has failed|no [a-z ]+ tab was open, so|nothing is selected|everything is already)/i; // said with "no"/"nothing", but fine
  const NEEDS_HELP = /matches\. say|say "click" and a number|which one|be more specific|say the one you want|number of the one/i;
  const REDACT = new Set(["type", "send", "fill", "fillOrType", "typeEmail", "typeNumber", "typeDate", "search", "searchText"]);
  const IGNORED_MSG = /^(?:thinking\.\.\.|listening\.\.\.)$/i;

  // A warning that comes a moment AFTER a command (a tick that didn't register): it must not land in whatever command is running now
  function sayLate(msg) {
    statusEl.textContent = msg; wake();
    if (lastLogged && lastLogged.entry.ok && FAIL_MSG.test(msg)) {
      lastLogged.entry.ok = false; lastLogged.entry.why = "failed"; lastLogged.entry.msg = msg.slice(0, 120);
      try { chrome.runtime.sendMessage({ type: "logUpdate", id: lastLogged.entry.id, patch: { ok: false, why: "failed", msg: lastLogged.entry.msg } }); } catch { /* reloaded */ }
    }
  }
  function noteSay(msg) {
    if (IGNORED_MSG.test(msg)) return;
    if (cmdCtx) { cmdCtx.msgs.push(msg); return; }
    // a warning that arrives after the command finished ("the page didn't change it"): the command did not really work
    if (lastLogged && lastLogged.entry.ok && Date.now() - lastLogged.at < 1500 && FAIL_MSG.test(msg)) {
      lastLogged.entry.ok = false; lastLogged.entry.why = "failed"; lastLogged.entry.msg = msg.slice(0, 120);
      try { chrome.runtime.sendMessage({ type: "logUpdate", id: lastLogged.entry.id, patch: { ok: false, why: "failed", msg: lastLogged.entry.msg } }); } catch { /* reloaded */ }
    }
  }

  function finishLog(raw, ctx, ms, err) {
    if (ctx.skip) return null;
    const last = ctx.msgs.length ? ctx.msgs[ctx.msgs.length - 1] : "";
    let ok = true, why = "";
    if (err) { ok = false; why = "error"; }
    else if (OK_MSG.test(last)) { ok = true; }
    else if (NEEDS_HELP.test(last)) { ok = false; why = "needed help"; }
    else if (FAIL_MSG.test(last) || (ctx.cmd === null && ctx.via === "ai" && /not sure|didn'?t understand|couldn'?t|can'?t/i.test(last))) { ok = false; why = "failed"; }
    const hide = ctx.redact || (document.activeElement && secret(document.activeElement)) || (ctx.cmd && REDACT.has(ctx.cmd.type) && (ctx.cmd.type !== "send" || ctx.cmd.text != null));
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      t: Date.now(),
      site: location.hostname.replace(/^www\./, ""),
      path: location.pathname.slice(0, 50),
      heard: hide ? `(${ctx.cmd ? ctx.cmd.type : "dictation"}: ${raw.length} characters, not stored)` : raw.slice(0, 140),
      en: !hide && ctx.en && ctx.en !== raw ? ctx.en.slice(0, 140) : undefined,
      cmd: ctx.cmd ? ctx.cmd.type + (ctx.cmd.op ? ":" + ctx.cmd.op : ctx.cmd.kind ? ":" + ctx.cmd.kind : "") : ctx.via === "ai" ? "ai" : "none",
      via: ctx.via,
      ok, why,
      msg: (err ? String(err.message || err) : hide ? last.replace(/"[^"]*"/g, '"..."').replace(/^([^:]{1,40}):.*$/, "$1: ...") : last).slice(0, 120),
      ms: Math.round(ms),
    };
    lastLogged = { entry, at: Date.now() };
    try { chrome.runtime.sendMessage({ type: "log", entry }); } catch { /* the extension was reloaded */ }
    return entry;
  }

  async function showLogCard(view) {
    let log = [];
    try { log = (await chrome.storage.local.get("vnlog")).vnlog || []; } catch { /* no storage */ }
    if (!log.length) return say("The log is empty so far");
    const failed = log.filter((e) => !e.ok);
    if (view === "all") {
      try { chrome.runtime.sendMessage({ type: "openLog" }); } catch { /* reloaded */ }
      return say(`${log.length - failed.length} worked, ${failed.length} didn't. Opening the log page`);
    }
    if (!failed.length) return say(`Nothing has failed: ${log.length} commands worked`);
    // the same phrase failing on the same site is one line with a count
    const groups = new Map();
    for (const e of failed.slice().reverse()) {
      const key = `${e.site}|${e.heard}`;
      const g = groups.get(key) || { e, n: 0 };
      g.n++; groups.set(key, g);
    }
    const lines = [...groups.values()].slice(0, 12).map(({ e, n }) => `${e.site}: "${e.heard}"${n > 1 ? ` (x${n})` : ""} - ${e.msg || e.why}`);
    showCard(`${failed.length} commands didn't work (${log.length - failed.length} did)`, [{ lines }, { heading: "More", lines: ['Say "show the log" for the full page, with every command and a download'] }], 60000);
    say(`${failed.length} failed`);
  }

  // ---------- several commands in one sentence: "open the project and then chat" ----------
  // Waits for the page to stop changing between steps. If a step loads another page, the rest is kept by the background
  // worker and carried on by the new page.
  function settle(max = 4000) {
    return new Promise((resolve) => {
      let timer = setTimeout(done, 700);
      const started = Date.now();
      const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, Date.now() - started > max ? 0 : 450); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      const cap = setTimeout(done, max);
      function done() { mo.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); }
    });
  }
  let preferNew = null; // during a chain: what was on the page before the previous step, so "chat" means the chat button that APPEARED
  async function runChain(parts) {
    let seen = null;
    for (let i = 0; i < parts.length; i++) {
      try { chrome.runtime.sendMessage({ type: "chainSet", parts: parts.slice(i + 1) }); } catch { /* reloaded */ }
      preferNew = i > 0 ? seen : null;
      scan();
      const mine = new Set(items.map((x) => x.el));
      const entry = await runOne(parts[i], { chained: true });
      preferNew = null;
      seen = mine;
      if (entry && entry.ok === false) {
        try { chrome.runtime.sendMessage({ type: "chainSet", parts: [] }); } catch { /* reloaded */ }
        return say(`Stopped: "${parts[i]}" didn't work${i < parts.length - 1 ? `, so I didn't do the rest` : ""}`.slice(0, 90));
      }
      if (pending) { // the step asked for a spoken yes: the rest must not run (or cancel the question)
        try { chrome.runtime.sendMessage({ type: "chainSet", parts: [] }); } catch { /* reloaded */ }
        return say(`Waiting for your "yes" or "cancel"; I stopped before: ${parts.slice(i + 1).join(", then ")}`.slice(0, 100));
      }
      if (i < parts.length - 1) {
        await settle();
        // did the step open or switch to another tab? The background worker knows which tab is showing: carry on there
        let moved = null;
        try { moved = await chrome.runtime.sendMessage({ type: "chainMove", parts: parts.slice(i + 1) }); } catch { /* reloaded */ }
        if (moved && moved.moved) return;
      }
    }
  }
  try { // a step that loaded a new page leaves the rest of the sentence with the background worker
    chrome.runtime.sendMessage({ type: "chainGet" }).then((r) => {
      if (r && r.parts && r.parts.length) setTimeout(() => runChain(r.parts), 1300);
    }).catch(() => {});
  } catch { /* reloaded */ }

  // ---------- other tabs and other sites ----------
  async function tabOp(cmd) {
    let res;
    try { res = await chrome.runtime.sendMessage({ type: "tabs", op: cmd.op, n: cmd.n, name: cmd.name, url: cmd.url }); }
    catch { return say("Extension was reloaded. Refresh this page"); }
    if (!res) return say("Couldn't reach the browser's tabs");
    if (res.error) return say(res.error);
    if (cmd.op === "list") {
      const lines = res.tabs.map((t) => `${t.index}. ${t.active ? "(this tab) " : ""}${t.title || t.host}${t.host ? ` - ${t.host}` : ""}`);
      showCard(`${res.tabs.length} tab${res.tabs.length === 1 ? "" : "s"} open`, [{ lines }, { heading: "Try", lines: ['"switch to the second tab"', '"switch to gmail"', '"next tab"', '"close this tab"'] }], 45000);
      return say(`${res.tabs.length} tabs`);
    }
    if (res.message) say(res.message);
  }
  // "open youtube": a link on this page with that name wins (YouTube's own logo, an Amazon result); otherwise go there
  function openSite(cmd) {
    if (!cmd.newTab && ((cmd.said && clickByText(cmd.said, true)) || clickByText(cmd.name, true))) return;
    // told to the background worker, so "undo" works from the new page (or closes the new tab) even though this page is gone
    try { chrome.runtime.sendMessage({ type: "clickMade", url: location.href, label: `opening ${cmd.name}`, navigates: !cmd.newTab, opensTab: !!cmd.newTab }); } catch { /* reloaded */ }
    if (cmd.newTab) return tabOp({ op: "new", url: cmd.url, name: cmd.name });
    pushUndo({ kind: "nav", reverse: "back" });
    say(`Opening ${cmd.name}`);
    location.href = cmd.url;
  }

  // ---------- video and audio ----------
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const mainMedia = () => mediaEls().find((e) => !e.paused && e.readyState > 0) || mediaEls().find((e) => isVisible(e) && e.readyState > 0) || mediaEls()[0] || null;
  function mediaSpeed(cmd) {
    const m = mainMedia();
    if (!m) return say("No video or audio found");
    let rate = cmd.rate;
    if (rate == null) {
      const cur = m.playbackRate;
      rate = cmd.delta > 0 ? RATES.find((r) => r > cur + 0.01) : [...RATES].reverse().find((r) => r < cur - 0.01);
      if (rate == null) return say(cmd.delta > 0 ? "Already as fast as it goes" : "Already as slow as it goes");
    }
    m.playbackRate = Math.min(16, Math.max(0.0625, rate));
    say(`Speed ${m.playbackRate}x`);
  }
  function mediaSeek(cmd) {
    const m = mainMedia();
    if (!m) return cmd.to === 0 && clickByText("restart", false) ? undefined : say("No video or audio found"); // "restart" may be a button on the page
    const dur = Number.isFinite(m.duration) ? m.duration : Infinity;
    const to = cmd.to != null ? cmd.to : m.currentTime + cmd.by;
    m.currentTime = Math.min(Math.max(0, to), dur === Infinity ? Math.max(0, to) : Math.max(0, dur - 0.5));
    const t = Math.round(m.currentTime), clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    say(cmd.to != null ? `Jumped to ${clock}` : `${cmd.by > 0 ? "Skipped ahead" : "Went back"} ${Math.abs(cmd.by)} seconds (now at ${clock})`);
  }
  // A button on this page, by CSS selectors (the site's own controls) and then by what it says
  function pageButton(selectors, labelRe, within) {
    for (const sel of selectors) {
      const el = [...document.querySelectorAll(sel)].find((e) => !host.contains(e) && e.getClientRects().length && (!within || within(e)));
      if (el) return el;
    }
    if (!labelRe) return null;
    scan();
    return items.find((it) => labelRe.test(it.full) && (!within || within(it.el)))?.el || null;
  }
  const notComment = (e) => !e.closest("ytd-comments,#comments,ytd-comment-thread-renderer,[id*=comment]");
  function pressed(el) { return el.getAttribute("aria-pressed") === "true"; }
  function mediaExtra(cmd) {
    const yt = /(^|\.)youtube\.com$/.test(location.hostname);
    const click = (el, msg, expectPressed) => {
      if (TEST_HOOK && host.dataset.dry === "1") { host.dataset.would = fullLabel(el); return say(`Would click: ${fullLabel(el)}`); }
      recordClick(el, msg); press(el); say(msg);
      // a like that needs you to sign in does nothing: say so rather than claim it worked
      if (expectPressed) setTimeout(() => { if (el.isConnected && !pressed(el)) sayLate(`Pressed ${msg.toLowerCase().replace(/d$/, "")}, but it didn't register. You may need to sign in`); }, 900);
    };
    switch (cmd.kind) {
      case "fullscreen": {
        const btn = pageButton([".ytp-fullscreen-button", "button[aria-label*='ull screen' i]", "button[title*='ull screen' i]"], /^full ?screen/i);
        if (btn) press(btn); else (mainMedia()?.requestFullscreen?.() || Promise.reject()).catch(() => {});
        // browsers refuse real fullscreen unless a person pressed something; say so, and use the next best thing
        return setTimeout(async () => {
          if (document.fullscreenElement) return say("Full screen");
          const theater = pageButton([".ytp-size-button"], null);
          if (theater && !document.querySelector("ytd-watch-flexy[theater]")) press(theater);
          try { await chrome.runtime.sendMessage({ type: "tabs", op: "windowFullscreen", on: true }); } catch { /* no background */ }
          say('Browser blocked real full screen from voice, so I made the window full and used theater mode. Say "exit full screen" to undo');
        }, 450);
      }
      case "exitFullscreen":
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        try { chrome.runtime.sendMessage({ type: "tabs", op: "windowFullscreen", on: false }); } catch { /* no background */ }
        return say("Left full screen");
      case "theater": {
        const b = pageButton([".ytp-size-button"], /^(?:theat(?:er|re)|cinema|wide)/i);
        return b ? click(b, "Theater mode") : say("No theater mode on this page");
      }
      case "captions": {
        const b = pageButton([".ytp-subtitles-button"], /^(?:subtitles?|captions?|cc)\b/i);
        if (!b) return say("No captions button on this page");
        const isOn = pressed(b);
        if (isOn === cmd.on) return say(`Captions are already ${cmd.on ? "on" : "off"}`);
        return click(b, `Captions ${cmd.on ? "on" : "off"}`);
      }
      case "expandMini": {
        const b = pageButton(["ytd-miniplayer .ytp-miniplayer-expand-watch-page-button", "ytd-miniplayer button[aria-label='Expand']", "ytd-miniplayer [aria-label*='xpand']", ".ytp-miniplayer-expand-watch-page-button"], /^expand\b|^maxim[ie][sz]e\b/i);
        return b ? click(b, "Opened the video from the corner") : say("I can't see a small video player here");
      }
      case "closeMini": {
        const b = pageButton(["ytd-miniplayer #close-button button", "ytd-miniplayer button[aria-label='Close']", ".ytp-miniplayer-close-button", "ytd-miniplayer [aria-label*='lose']"], null);
        return b ? click(b, "Closed the small player") : say("I can't see a small video player here");
      }
      case "next": {
        const b = pageButton([".ytp-next-button", "button[aria-label^='Next' i]", "a[aria-label^='Next' i]"], /^next\b/i);
        return b ? click(b, "Next") : say("No next button on this page");
      }
      case "previous": {
        const b = pageButton([".ytp-prev-button", "button[aria-label^='Previous' i]"], /^previous\b/i);
        return b ? click(b, "Previous") : say("No previous button on this page");
      }
      case "skipAd": {
        const b = pageButton([".ytp-skip-ad-button", ".ytp-ad-skip-button", ".ytp-ad-skip-button-modern", "button[id^='skip-button']"], /^skip(?: ad| ads)?$/i);
        return b ? click(b, "Skipped the ad") : say("There is no ad to skip right now");
      }
      case "like": case "dislike": {
        const word = cmd.kind;
        const b = yt
          ? pageButton(word === "like" ? ["segmented-like-dislike-button-view-model like-button-view-model button", "like-button-view-model button", "#segmented-like-button button", "ytd-menu-renderer #top-level-buttons-computed ytd-toggle-button-renderer:first-child button"]
            : ["segmented-like-dislike-button-view-model dislike-button-view-model button", "dislike-button-view-model button", "#segmented-dislike-button button"], null, notComment)
          : pageButton([], new RegExp(`^${word}\\b`, "i"), notComment);
        if (!b) return say(`I can't find the ${word} button${yt ? " (open a video first)" : ""}`);
        if (pressed(b)) return say(`Already ${word}d`);
        return click(b, word === "like" ? "Liked" : "Disliked", true);
      }
      case "subscribe": {
        const b = pageButton(yt ? ["#subscribe-button-shape button", "ytd-subscribe-button-renderer button", "#subscribe-button button"] : [], /^subscribe\b/i, notComment);
        if (!b) return say("I can't find a Subscribe button");
        if (/^subscribed\b/i.test(fullLabel(b)) || pressed(b)) return say("Already subscribed");
        return askFirst("Subscribe", () => click(b, "Subscribed"));
      }
    }
  }

  // ---------- search, selecting, backing out ----------
  let awaiting = null; // after "search": the next thing you say is typed into the box
  const awaitingFresh = () => !!(awaiting && Date.now() - awaiting.at < 25000 && (!awaiting.el || awaiting.el.isConnected));
  function focusSearch() {
    const ready = (box) => { box.scrollIntoView({ block: "center", behavior: TEST_HOOK ? "instant" : "smooth" }); box.focus(); awaiting = { el: box, at: Date.now() }; return say('Search is ready. Say what to look for'); };
    const box = visibleBoxes().find(isSearchy);
    if (box) return ready(box);
    // the site hides it behind an icon ("Search chats", a magnifying glass): press that, then look for the box that appears
    scan();
    const hits = items.filter((it) => /\bsearch\b/i.test(`${it.full} ${hintOf(it.el)}`) && !/results?\b|history\b/i.test(it.full) && roleOf(it.el) !== "textbox");
    if (!hits.length) return say("I can't find a search box or search button here");
    const pick = hits.find((it) => /^search\b/i.test(it.full) && it.el.closest("nav,aside,header,[role=navigation]")) || hits.find((it) => /^search\b/i.test(it.full)) || hits[0];
    recordClick(pick.el, pick.label); press(pick.el);
    awaiting = { el: null, at: Date.now() }; // the box appears a moment after the click; the next thing you say goes into it
    say(`Clicked "${pick.label || "search"}"`);
    return setTimeout(() => {
      const b = visibleBoxes().find(isSearchy) || (document.activeElement?.matches?.(TEXTY) ? document.activeElement : null);
      if (b) ready(b); else sayLate(`Clicked "${pick.label}", but no search box appeared`);
    }, 500);
  }
  function typeAwaiting(raw) {
    const el = awaiting.el && awaiting.el.isConnected ? awaiting.el : visibleBoxes().find(isSearchy) || (document.activeElement?.matches?.(TEXTY) ? document.activeElement : null);
    awaiting = null;
    if (!el) return say("No search box appeared to type into");
    const text = raw.trim().replace(/[.]$/, "");
    el.focus();
    const entry = pushUndo({ kind: "text", el, prev: rawText(el) });
    if (!setValue(el, text)) return say("Couldn't type into the search box");
    markInserted(entry, el);
    if (el.closest("form")) { submit(el); return say(`Searching for "${text}"`); }
    say(`Typed "${text}" in the search box`);
  }
  function uncheckAll() {
    const boxes = [...document.querySelectorAll('input[type=checkbox]:checked,[role=checkbox][aria-checked=true]')].filter((e) => !host.contains(e) && e.getClientRects().length && !e.closest("form") && !e.closest("[role=switch]"));
    if (!boxes.length) return say("Nothing is selected");
    let n = 0;
    for (const el of boxes) {
      if (!el.isConnected || !isOn(el)) continue; // an earlier click (a select-all box) may already have cleared it
      recordClick(el, fullLabel(el) || "selection"); press(el); n++;
    }
    say(`Deselected ${n}`);
  }
  function selectAllItems() {
    scan();
    const master = items.find((it) => /^(?:select(?: all)?|all)$/i.test(it.full) && /checkbox/.test(roleOf(it.el)));
    if (!master) return say("I can't find a select-all box here");
    if (isOn(master.el)) return say("Everything is already selected");
    recordClick(master.el, "select all"); press(master.el);
    say("Selected all");
  }

  // The words icons go by, and the words a site hides in its code for them (data-testid, ids, icon names)
  const UI_SYNONYMS = [
    ["plus", "add", "attach", "upload", "paperclip", "add files", "attachment"],
    ["mic", "mouse", "microphone", "dictate", "dictation", "voice", "speak", "speech"],
    ["search", "magnifier", "magnifying glass", "find"],
    ["settings", "gear", "cog", "preferences"],
    ["menu", "hamburger", "three lines", "sidebar", "side bar", "navigation", "toggle sidebar"],
    ["close", "cross", "dismiss", "exit", "x"],
    ["more", "three dots", "ellipsis", "kebab", "overflow", "options"],
    ["back", "previous", "return"],
    ["share", "send to"],
    ["notifications", "bell", "alerts"],
    ["profile", "account", "avatar", "user"],
    ["cart", "basket", "bag", "trolley"],
    ["home", "logo", "homepage"],
    ["new chat", "compose", "new conversation", "new message", "start chat"],
  ];
  const ICON_FILLER = /\b(?:icon|icons|symbol|sign|image|picture|button|key)\b/g;
  function hintOf(el) {
    if (el.__vnHint !== undefined) return el.__vnHint;
    const svg = el.querySelector?.("svg title, svg use");
    const bits = [el.getAttribute("data-testid"), el.getAttribute("data-test-id"), el.getAttribute("data-icon"), el.id, el.getAttribute("name"), el.getAttribute("title"), el.getAttribute("aria-description"),
      svg ? (svg.tagName.toLowerCase() === "title" ? svg.textContent : (svg.getAttribute("href") || svg.getAttribute("xlink:href") || "").replace(/^.*#/, "")) : ""];
    return (el.__vnHint = norm(bits.filter(Boolean).join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ")).replace(/\b(?:btn|button|icon|svg|ui)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 100));
  }
  // Items whose hidden name, or a synonym of what you said, matches. Used only when the visible words matched nothing.
  function hintMatches(pool, p) {
    const q = p.replace(ICON_FILLER, " ").replace(/\s+/g, " ").trim();
    if (!q) return [];
    const has = (hay, needle) => !!hay && (" " + hay + " ").includes(" " + needle + " ");
    const words = new Set([q]);
    for (const g of UI_SYNONYMS) if (g.includes(q)) g.forEach((w) => words.add(w));
    const tiers = [];
    for (const it of pool) {
      const label = norm(it.full || it.label || ""), hint = hintOf(it.el);
      let best = 9;
      for (const w of words) {
        if (label === w) best = Math.min(best, 0);
        else if (has(label, w) && label.split(" ").length <= 4) best = Math.min(best, w === q ? 1 : 2);
        else if (has(hint, w)) best = Math.min(best, w === q ? 3 : 4);
      }
      if (best < 9) tiers.push({ it, score: best });
    }
    tiers.sort((a, b) => a.score - b.score);
    return tiers.filter((x) => x.score === tiers[0]?.score);
  }

  // "comment on this video" / "add a comment": scroll to the comments (they load lazily), open the box, and focus it
  async function openComment() {
    const find = () => document.querySelector("ytd-comments #simple-box #placeholder-area, ytd-comment-simplebox-renderer #placeholder-area, #placeholder-area");
    const editor = () => document.querySelector("ytd-commentbox #contenteditable-root, #contenteditable-root");
    if (!location.hostname.endsWith("youtube.com")) return say("Comments are only set up for YouTube. Say the name of the comment box to click it");
    say("Finding the comment box...");
    let ph = find();
    for (let i = 0; i < 12 && !ph; i++) { // comments only load once you scroll near them
      (document.querySelector("ytd-comments#comments") || document.scrollingElement).scrollIntoView({ block: "start" });
      await sleep(400); ph = find();
    }
    if (!ph) return say("Couldn't find a comment box (comments may be off, or you aren't signed in)");
    ph.scrollIntoView({ block: "center" });
    recordClick(ph, "comment box");
    press(ph);
    let ed = null;
    for (let i = 0; i < 10 && !ed; i++) { await sleep(150); ed = editor(); }
    if (!ed) return say('Opened the comment area but couldn\'t find where to type. Say "click add a comment"');
    ed.focus();
    say('Comment box ready. Say "type ..." then "click comment"');
  }

  async function setOfflineSpeech(on) {
    if (on) {
      let st;
      try { st = await chrome.runtime.sendMessage({ type: "sttStatus" }); } catch { return say("Extension was reloaded. Refresh this page"); }
      if (!st || st.offline) return say("The backend isn't running, so offline speech can't start. Run start-backend.ps1");
      if (!st.available) return say("Offline speech isn't installed: pip install -r backend/requirements-whisper.txt, then restart the backend");
    }
    useWhisper = on;
    try { chrome.storage.local.set({ useWhisper: on }); } catch { /* no storage */ }
    if (listening) { stopRecognizer(); startRecognizer(); }
    say(on ? "Offline speech on (Whisper on this computer)" : "Using Chrome's speech recogniser");
  }

  // A genuine key press through the browser's debugger (the "debugging" bar shows for an instant)
  async function pressKey(key, spoken, onDone) {
    let r;
    try { r = await chrome.runtime.sendMessage({ type: "trustedKey", key }); } catch { return say("Extension was reloaded. Refresh this page"); }
    if (!r || !r.ok) return say(`Couldn't press ${spoken}${r?.error ? ": " + r.error : ""}`);
    if (onDone) return onDone();
    say(`Pressed ${spoken}`);
  }

  // ---------- spoken replies and the guided tour ----------
  // Speaking pauses the recognizer so VoiceNav never hears (and obeys) its own voice.
  let speakingNow = false, talkBack = false;
  try { chrome.storage.local.get("talkBack").then((o) => { talkBack = !!o.talkBack; }); } catch { /* no storage */ }
  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return false;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 900));
      u.lang = lang === "hi-IN" ? "hi-IN" : "en-IN";
      const done = () => { speakingNow = false; if (listening) setTimeout(startRecognizer, 400); };
      u.onstart = () => { speakingNow = true; stopRecognizer(); };
      u.onend = done; u.onerror = done;
      if (TEST_HOOK) host.dataset.spoke = text;
      speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  }
  function hush() {
    try { speechSynthesis.cancel(); } catch { /* none */ }
    if (speakingNow) { speakingNow = false; if (listening) setTimeout(startRecognizer, 200); }
  }

  // What this page is, in a few sentences: its headings, whether it has results, a search box, a chat box, a form or a video,
  // and the first things you can press. Shown on a card and read aloud, so someone who can't see or use a mouse can find their way.
  function pageOverview() {
    const heads = [];
    for (const h of document.querySelectorAll("h1,h2,h3,[role=heading]")) {
      if (host.contains(h) || !isVisible(h)) continue;
      const t = (h.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= 3 && t.length <= 90 && !heads.includes(t)) heads.push(t);
      if (heads.length >= 5) break;
    }
    scan();
    const can = [];
    const results = [...resultMarks()].filter(([, m]) => m.rank >= 0).length;
    if (results) can.push(`${results} results you can open by position, like "open the second result"`);
    const sb = searchBox();
    if (sb && isSearchy(sb)) can.push('a search box: say "search for" and what you want');
    const chat = composerBox();
    if (chat && composerScore(chat) >= 3) can.push('a message box: say "type" and your message, then "send"');
    const fields = queryDeep(FIELD_SEL).filter((e) => !host.contains(e) && isVisible(e)).length;
    if (fields > 1) can.push(`${fields} form fields: say "list fields", then "fill name with" and a value`);
    if (mediaEls().length) can.push('a video or audio player: "pause", "play", "skip 10 seconds"');
    const buttons = items.filter((it) => /^(?:button|link|tab|menuitem)$/.test(roleOf(it.el)) && it.label && !it.offscreen).slice(0, 8).map((it) => it.label.slice(0, 40));
    const site = location.hostname.replace(/^www\./, "");
    const spoken = [`You are on ${site}.`, document.title ? `The page is called ${document.title.slice(0, 90)}.` : "",
      heads.length ? `Main headings: ${heads.slice(0, 4).join(", ")}.` : "",
      can.length ? `Here you can: ${can.slice(0, 3).join("; ")}.` : "",
      buttons.length ? `On screen: ${buttons.slice(0, 5).join(", ")}.` : "",
      `There are ${items.length} things you can click. Say "show numbers" to pick one.`].filter(Boolean).join(" ");
    return { site, heads, can, buttons, spoken };
  }
  function tour() {
    const o = pageOverview();
    const sections = [];
    if (o.heads.length) sections.push({ heading: "Headings", lines: o.heads });
    if (o.can.length) sections.push({ heading: "You can", lines: o.can });
    if (o.buttons.length) sections.push({ heading: "On screen now", lines: o.buttons });
    showCard(`${o.site}: ${document.title.slice(0, 60) || "this page"}`, sections.length ? sections : [{ lines: ["Nothing readable found on screen"] }], 60000);
    const talked = speak(o.spoken);
    say(talked ? 'Reading the page. Say "stop reading" to stop' : "Page overview shown (this browser can't speak)");
  }

  // ---------- executing parsed commands ----------
  function execute(cmd) {
    switch (cmd.type) {
      case "confirm": {
        if (!pending) return say("Nothing to confirm");
        const fn = pending; pending = null;
        return cmd.yes ? fn() : say("Cancelled");
      }
      case "close": return closeTopmost(cmd.back);
      case "tab": return tabOp(cmd);
      case "openSite": return openSite(cmd);
      case "log": return showLogCard(cmd.view);
      case "logClear": return askFirst("Clear the whole log", async () => { try { await chrome.storage.local.remove("vnlog"); } catch { /* none */ } say("Log cleared"); });
      case "mediaSpeed": return mediaSpeed(cmd);
      case "mediaSeek": return mediaSeek(cmd);
      case "mediaExtra": return mediaExtra(cmd);
      case "focusSearch": return focusSearch();
      case "uncheckAll": return uncheckAll();
      case "selectAllItems": return selectAllItems();
      case "help": return showCard("What you can say", helpSections());
      case "hideCard": return hideCard();
      case "undo": return undo();
      case "readResults": return readResults();
      case "autoScroll": return startAutoScroll(cmd.dir, cmd.speed);
      case "scrollMore": {
        // "slowly" / "keep going" on its own: only means something right after a scroll
        if (!auto && !(lastScroll && Date.now() - lastScroll.at < 8000)) return;
        return startAutoScroll(auto ? auto.dir : lastScroll.dir, cmd.speed || "medium");
      }
      case "stopScroll": return stopAutoScroll(true) || say("Not scrolling");
      case "sortBy": {
        const sel = [...document.querySelectorAll("select")].find((s) => s.getClientRects().length && /sort/i.test(`${fullLabel(s)} ${s.id} ${s.name}`));
        if (sel && chooseOption(sel, cmd.text)) return;
        return say(sel ? `No sort option like "${cmd.text}"` : "I can't find a sort control on this page");
      }
      case "scrollSpeed": {
        // "faster" / "slower" with a video playing and no scroll going means the video's speed
        if (!auto) return mainMedia() && !mainMedia().paused ? mediaSpeed({ delta: cmd.faster ? 1 : -1 }) : say("Not scrolling. Say \"scroll down slowly\" first");
        auto.pps = Math.min(900, Math.max(20, auto.pps * (cmd.faster ? 1.6 : 1 / 1.6)));
        return say(`Scrolling ${Math.round(auto.pps)} pixels a second`);
      }
      case "movePanel": {
        placePanel(cmd.v || panel.dataset.v, cmd.h || panel.dataset.h);
        return say(`Moved to the ${panel.dataset.v} ${panel.dataset.h}`);
      }
      case "panel": {
        panel.classList.toggle("hidden", !cmd.show);
        return cmd.show ? say("Panel shown") : undefined;
      }
      case "off": return setListening(false);
      case "snooze": return setAsleep(true);
      case "wakeUp": return say("Already listening");
      case "attention": return setAttention(cmd.on);
      case "lang": return setLang(cmd.lang);
      case "halt": { // "band karo": stop what is going on, whatever it is
        if (stopAutoScroll(true)) return;
        const popup = document.querySelector('dialog[open],[role=dialog]:not([hidden]),[role=alertdialog]:not([hidden]),[aria-modal=true]:not([hidden])');
        if (popup && popup.getClientRects().length) return closeTopmost();
        if (mediaEls().some((e) => !e.paused)) return mediaAction("pause");
        return closeTopmost();
      }
      case "numbers": numbersOn = cmd.on; drawBadges(); return say(cmd.on ? `Showing ${items.length} numbers` : "Numbers hidden");
      case "scroll": return scrollPage(cmd.dir, cmd.amount, cmd.area);
      case "scrollEdge":
        rememberScroll(document.scrollingElement);
        say(cmd.to === "top" ? "Top of the page" : "Bottom of the page");
        return window.scrollTo({ top: cmd.to === "top" ? 0 : document.scrollingElement.scrollHeight, behavior: TEST_HOOK ? "instant" : "smooth" });
      case "nav":
        say({ back: "Going back", forward: "Going forward", reload: "Reloading" }[cmd.to]);
        if (cmd.to !== "reload") pushUndo({ kind: "nav", reverse: cmd.to === "back" ? "forward" : "back" });
        return cmd.to === "reload" ? location.reload() : history[cmd.to]();
      case "trusted":
        try { chrome.storage.local.set({ trustedClicks: cmd.on }); } catch { /* no storage */ }
        trustedClicks = cmd.on;
        return say(cmd.on ? "Real clicks on: used when a click changes nothing" : "Real clicks off");
      case "tour": return tour();
      case "stt": return setOfflineSpeech(cmd.on);
      case "pressKey": return pressKey(cmd.key, cmd.spoken);
      case "docsVoice": {
        if (location.hostname !== "docs.google.com") return say("Voice typing is a Google Docs feature. Open a document first");
        return pressKey({ key: "S", code: "KeyS", vk: 83, ctrl: true, shift: true }, "control shift s", () => {
          setListening(false, { remember: false, quiet: true }); // two things can't both listen: pause VoiceNav while Google's voice typing runs
          say("Google voice typing started. VoiceNav is paused: press Alt+V to bring it back");
        });
      }
      case "hush": hush(); return say("Stopped");
      case "talkBack":
        talkBack = cmd.on;
        try { chrome.storage.local.set({ talkBack }); } catch { /* no storage */ }
        if (!talkBack) hush();
        say(talkBack ? "I will speak my replies" : "Spoken replies off");
        return talkBack ? speak("Spoken replies on") : undefined;
      case "comment": return openComment();
      case "rename": return renameDoc(cmd.text);
      case "typeIn": {
        if (cmd.target === "title" && document.querySelector("input.docs-title-input")) return renameDoc(cmd.text);
        if (cmd.target === "document" && docsEditor()) return typeInDocument(cmd.text);
        if (cmd.target === "gemini") {
          const b = boxByPurpose("gemini");
          if (b) return typeInto(b, cmd.text);
          return say('Can\'t find a Gemini box. Open it first ("click Gemini")');
        }
        return execute({ type: "type", text: cmd.full });
      }
      case "media": return mediaAction(cmd.kind);
      case "clickNumber": {
        // While numbers are on screen, use exactly those; rescanning could renumber things under the user
        if (!numbersOn || !items.length) scan();
        const it = items[cmd.n - 1];
        return it ? doClick(it) : say(`No item ${cmd.n}. Say "show numbers"`);
      }
      case "search": {
        const box = searchBox();
        if (!box) return say("No search box found");
        // A chat page with no search field: "search for X" means asking the chat
        if (!isSearchy(box) && composerScore(box) >= 3) return sendMessage(cmd.text);
        box.focus(); setValue(box, cmd.text); submit(box);
        return say(`Searching for "${cmd.text}"`);
      }
      case "type": {
        // A box you clicked into wins. With nothing focused, in Google Docs the text goes into the document, not a side panel.
        const act = activeDeep();
        const docs = !(act && act.matches?.(TEXTY) && !host.contains(act)) ? docsEditor() : null;
        if (docs) {
          docs.ed.focus();
          const ok = docs.doc.execCommand("insertText", false, cmd.text);
          return say(ok ? `Typed "${cmd.text}" in the document` : "Google Docs didn't take that. Click into the page, then try again");
        }
        if (!(act && act.matches?.(TEXTY) && !host.contains(act)) && location.hostname === "docs.google.com") return say("Can't find the document's editor. Click on the page once, then try again");
        const box = typeTarget();
        if (!box) return say('No text box found. Say "click" and a number first');
        box.focus();
        const entry = pushUndo({ kind: "text", el: box, prev: rawText(box) });
        if (!setValue(box, cmd.text)) return say("Couldn't type into that box");
        markInserted(entry, box);
        return say(`Typed "${cmd.text}"`);
      }
      case "clear": { const b = typeTarget(); if (b) { pushUndo({ kind: "text", el: b, prev: boxText(b) }); b.focus(); setValue(b, ""); } return say("Cleared"); }
      // "submit" / "press enter": like send, it presses the box's own button when there is one (chat editors ignore a
      // synthetic Enter); otherwise it submits the form or presses Enter.
      case "submit": return sendMessage(null, "Submitted");
      case "send": return sendMessage(cmd.text ?? null);
      case "dictate": return cmd.on ? (dictating ? say("Already dictating") : startDictation()) : stopDictation();
      case "nextField": return moveField(cmd.dir);
      case "listFields": return listFields();
      case "readField": return readField();
      case "edit": return editBox(cmd.op, cmd);
      case "fill": return fillByName(cmd.field, cmd.value, cmd);
      case "fillOrType": return fillOrType(cmd);
      case "check": return checkByName(cmd.field, cmd.on, cmd.hint);
      case "typeNumber": return typeSpecial("number", cmd.text, cmd.full);
      case "typeEmail": return typeSpecial("email", cmd.text, cmd.full);
      case "typeDate": return typeSpecial("date", cmd.text, cmd.full);
      case "repeat": return lastRepeat ? execute(lastRepeat) : say("Nothing to repeat");
    }
  }

  // ---------- AI fallback ----------
  // "The second result" should mean the second product or video, but a result card holds several links (image, title,
  // channel, ratings...). On sites people use most, say which link is the card's main one. Other sites fall back to a guess.
  const ADAPTERS = [
    { host: /(^|\.)amazon\.[a-z.]+$/, card: '[data-component-type="s-search-result"]', link: "h2 a, a:has(> h2)", price: ".a-price .a-offscreen",
      // sponsored Prime Video rentals appear among the products ("Shampoo", the 1975 film, for Rs 99): not something you shop for
      skip: (link) => (link.getAttribute("href") || "").startsWith("/gp/video/") },
    { host: /(^|\.)youtube\.com$/, card: "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer", link: "a#video-title, a#video-title-link" },
    { host: /(^|\.)google\.[a-z.]+$/, links: "#rso a:has(h3), #search a:has(h3)" }, // each organic result's title link
    // Without these, "the second result" was a guess that picked the first result (Bing) or a sitelink (DuckDuckGo)
    { host: /(^|\.)bing\.com$/, links: "#b_results > li.b_algo h2 a" },
    { host: /(^|\.)duckduckgo\.com$/, links: "article[data-testid=result] a[data-testid=result-title-a]" },
  ];
  if (TEST_HOOK) ADAPTERS.push({ host: /^127\.0\.0\.1$/, card: ".result", link: "a.title", price: ".price" }); // test pages only
  // Test pages can say which site's markup they copy (?vn-host=duckduckgo.com); shipped code always uses the real hostname
  const siteHost = (TEST_HOOK && new URLSearchParams(location.search).get("vn-host")) || location.hostname;
  const adapter = ADAPTERS.find((a) => a.host.test(siteHost));
  const MAX_RESULTS = 150; // price comparisons ("the most expensive one") should see the whole page; the AI prompt gets a shorter list

  function onScreen(el) {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && isVisible(el);
  }

  // ---------- learning a site's result layout ----------
  // For sites without a hand-written adapter, detector.js works out which blocks are the results. The layout it finds is saved
  // as a small rule (CSS selectors only, never code) keyed by site and page type, so the next visit just re-checks it.
  // One storage entry per site ("rule:<key>"), written only when that rule changes, so two tabs can never overwrite each
  // other's rules. The key is the site plus the SHAPE of the page (first path segment, and how deep the path is), so a rule
  // learned on a listing is not reused on a detail page of the same site.
  let siteRules = {};
  try {
    chrome.storage.local.get(null).then((all) => {
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith("rule:") && v && typeof v.card === "string") siteRules[k.slice(5)] = { ...v, ...(siteRules[k.slice(5)] || {}) };
      }
    });
    chrome.storage.local.remove("siteRules"); // the earlier single-object format
  } catch {}
  const dirtyRules = new Set();
  let saveTimer;
  function persistRule(key) {
    dirtyRules.add(key);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const keys = [...dirtyRules];
      dirtyRules.clear();
      const batch = {}, gone = [];
      for (const k of keys) (siteRules[k] ? (batch[`rule:${k}`] = siteRules[k]) : gone.push(`rule:${k}`));
      try {
        if (Object.keys(batch).length) await chrome.storage.local.set(batch);
        if (gone.length) await chrome.storage.local.remove(gone);
        // keep the 300 rules used most recently
        const all = Object.keys(siteRules);
        if (all.length > 300) {
          const used = (k) => siteRules[k].lastUsed || siteRules[k].savedAt || 0;
          const drop = all.sort((a, b) => used(a) - used(b)).slice(0, all.length - 300);
          for (const k of drop) delete siteRules[k];
          await chrome.storage.local.remove(drop.map((k) => `rule:${k}`));
        }
      } catch { /* storage unavailable: rules just won't be remembered */ }
    }, 1500);
  }
  let autoMemo = { url: "", at: 0, results: [] };
  function autoResults() {
    if (typeof VoiceNavDetector === "undefined") return [];
    const now = Date.now();
    // one command asks several times; a page with no results is not re-analysed for every command either
    if (autoMemo.url === location.href && now - autoMemo.at < (autoMemo.results.length ? 1500 : 8000)) return autoMemo.results;
    const segments = location.pathname.split("/").filter(Boolean);
    const key = `${location.hostname}|${segments[0] || ""}|${Math.min(segments.length, 4)}`;
    let results = [];
    const saved = siteRules[key];
    if (saved) {
      results = VoiceNavDetector.apply(saved, document);
      // still trustworthy only if it finds about as many results as when it was learned
      const fine = results.length >= 3 && (!saved.n || (results.length >= saved.n * 0.7 && results.length <= saved.n * 1.3));
      if (fine) { saved.hits = (saved.hits || 0) + 1; saved.lastUsed = now; persistRule(key); } // usage decides what to keep when the store fills up
      else { delete siteRules[key]; results = []; persistRule(key); } // the layout changed: forget the rule and look again
    }
    if (!results.length) {
      const found = VoiceNavDetector.detect(document);
      if (found) {
        results = found.results;
        if (found.rule) { siteRules[key] = { ...found.rule, savedAt: now, hits: 0 }; persistRule(key); }
      }
    }
    autoMemo = { url: location.href, at: now, results };
    return results;
  }

  // Main links of the results on the page, ranked from the first one you can SEE (rank 0). Results already scrolled
  // past get a negative rank, and ones further down the page keep counting, so "the second one" is the second you see.
  function resultMarks() {
    const marks = new Map();
    let raw = [];
    let skip = null;
    if (adapter) {
      skip = adapter.skip;
      if (adapter.links) {
        for (const link of document.querySelectorAll(adapter.links)) raw.push({ link, price: null });
      } else {
        for (const card of document.querySelectorAll(adapter.card)) {
          const link = card.querySelector(adapter.link);
          const m = adapter.price && card.querySelector(adapter.price)?.textContent.match(PRICE);
          if (link) raw.push({ link, price: m ? parseFloat(m[1].replace(/,/g, "")) : null });
        }
      }
    }
    if (!raw.length) { raw = autoResults(); skip = null; } // no adapter, or it found nothing: work it out from the page itself
    if (!raw.length) return marks;
    const shown = raw.filter((x) => x.link.getClientRects().length && !host.contains(x.link) && !(skip && skip(x.link))); // skip hidden template copies and non-products
    const flags = shown.map((x) => onScreen(x.link));
    let first = flags.indexOf(true);
    if (first < 0) first = 0; // nothing visible: count from the top
    shown.forEach((x, i) => {
      if (i - first < -5 || i - first >= MAX_RESULTS) return; // a window around the screen keeps the payload small
      marks.set(x.link, { price: x.price, rank: i - first, onscreen: flags[i] });
    });
    return marks;
  }

  // Make sure an element has an entry in `items` (and so a numbered id), even if it's off screen.
  function itemIndex(el) {
    let i = items.findIndex((it) => it.el === el);
    if (i < 0) { items.push({ el, label: labelOf(el), full: fullLabel(el), offscreen: true }); i = items.length - 1; }
    return i;
  }

  function aiPayload(command) {
    scan();
    const visible = items.slice(); // what's visible now; off-screen result links get appended to `items` below
    const marks = resultMarks();
    const entry = (el, i) => {
      const mark = marks.get(el);
      const q = questionText(el); // a question that expands when clicked; the role lets "the second question" count them
      return {
        id: i + 1,
        role: q ? "question" : roleOf(el),
        label: (q || items[i].label || el.name || "(unlabelled)").slice(0, q ? 120 : 80),
        // On sites we recognise the card's own price is enough; guessing a price for every element is slow on big pages
        price: mark ? mark.price : marks.size ? null : priceOf(el),
        result: !!mark, rank: mark ? mark.rank : null, onscreen: mark ? mark.onscreen : true,
      };
    };
    // Results go in first so the size cap can't cut them off, then everything else in page order
    const list = [];
    for (const el of marks.keys()) list.push(entry(el, itemIndex(el)));
    let others = 0;
    visible.forEach((it, i) => {
      if (marks.has(it.el) || others >= MAX_AI_ELEMENTS || !(it.label || it.el.matches(TEXTY))) return;
      list.push(entry(it.el, i));
      others++;
    });
    list.sort((a, b) => a.id - b.id);
    return { command: command.slice(0, 300), elements: list, url: location.href, title: document.title.slice(0, 80) };
  }

  async function askAI(command) {
    if (cmdCtx) cmdCtx.via = "ai";
    say("Thinking...");
    let res;
    const payload = aiPayload(command);
    const snapshot = items.slice(); // the reply's ids refer to these; the page may be rescanned while we wait
    try {
      res = await chrome.runtime.sendMessage({ type: "interpret", payload });
    } catch { res = { action: "none", message: "Extension was reloaded. Refresh this page" }; }
    if (!res) res = { action: "none", message: "No reply from AI" };
    if (res.latency_ms) heardEl.textContent += `  (${res.source}, ${(res.latency_ms / 1000).toFixed(1)}s)`;

    switch (res.action) {
      case "click": {
        const it = snapshot[res.id - 1];
        return it ? doClick(it, snapshot) : say("Couldn't find that item");
      }
      case "search": return execute({ type: "search", text: res.text });
      case "type": return execute({ type: "type", text: res.text });
      case "scroll": return execute({ type: "scroll", dir: res.direction || "down", amount: 0.8 });
      case "back": return execute({ type: "nav", to: "back" });
      case "forward": return execute({ type: "nav", to: "forward" });
      case "pause": case "play": return mediaAction(res.action);
      default:
        if (res.show_numbers) { numbersOn = true; drawBadges(); } // "Which one?" is easier to answer with numbers on screen
        return say(res.message || "Not sure what you meant");
    }
  }

  // Two ways to stay quiet during a call or conversation:
  //  - asleep: ignore everything except "wake up"
  //  - wake word mode: only act on utterances that start with "Nova" or "Computer"
  let asleep = false, attention = false;

  function setAsleep(on) {
    asleep = on;
    micBtn.classList.toggle("asleep", on);
    say(on ? 'Sleeping. Say "wake up"' : "Listening...");
  }
  function showAttention(on) {
    attention = on;
    attBtn.textContent = on ? "Wake: on" : "Wake: off";
    attBtn.classList.toggle("on", on);
  }
  function setAttention(on) {
    showAttention(on);
    try { chrome.storage.local.set({ attention: on }); } catch {}
    say(on ? 'Wake word on. Start with "Nova"' : "Always listening");
  }
  try { chrome.storage.local.get("attention").then((o) => showAttention(!!o.attention)); } catch {}
  attBtn.addEventListener("click", () => setAttention(!attention));

  function showLang(l) {
    lang = l === "hi-IN" ? "hi-IN" : "en-IN";
    const hi = lang === "hi-IN";
    langBtn.textContent = hi ? "हिं" : "EN";
    langBtn.setAttribute("aria-label", hi ? "Speech language: Hindi. Click for English" : "Speech language: English. Click for Hindi");
    langBtn.classList.toggle("on", hi);
    if (TEST_HOOK) host.dataset.lang = lang;
  }
  // The recognizer's language is fixed when it starts, so a change restarts it (if it is running)
  function restartRecognizer() { if (!rec) return; stopRecognizer(); setTimeout(startRecognizer, 350); }
  function setLang(l) {
    const before = lang;
    showLang(l);
    try { chrome.storage.local.set({ lang }); } catch {}
    if (lang !== before) restartRecognizer();
    say(lang === "hi-IN" ? 'Hindi (हिंदी). Say "English mein bolo" to switch back' : 'English. Say "Hindi mein bolo" for Hindi');
  }
  try { chrome.storage.local.get("lang").then((o) => showLang(o.lang)); } catch {}
  try { // changed in another tab
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.lang && ch.lang.newValue !== lang) { showLang(ch.lang.newValue); restartRecognizer(); }
    });
  } catch {}
  langBtn.addEventListener("click", () => setLang(lang === "hi-IN" ? "en-IN" : "hi-IN"));

  async function handle(raw) {
    if (asleep) {
      const cmd = VoiceNavParser.parse(VoiceNavParser.toEnglish(VoiceNavParser.stripWake(raw) ?? raw));
      if (cmd?.type === "wakeUp") { heardEl.textContent = `Heard: "${raw}"`; return setAsleep(false); }
      heardEl.textContent = `Sleeping, ignored: "${raw}"`;
      return;
    }
    if (attention) {
      const rest = VoiceNavParser.stripWake(raw);
      if (rest === null) { heardEl.textContent = `Ignored (no wake word): "${raw}"`; return; }
      if (!rest) { heardEl.textContent = 'Heard "Nova"'; return say("Yes?"); }
      raw = rest;
    }
    // "open the project and then chat": several commands in one sentence
    const parts = !dictating && !awaitingFresh() ? VoiceNavParser.splitChain(VoiceNavParser.toEnglish(raw)) : null;
    if (parts) { heardEl.textContent = `Heard: "${raw}"`; wake(); return runChain(parts); }
    return runOne(raw);
  }

  // One command, with its result written to the log
  async function runOne(raw, opts = {}) {
    const ctx = cmdCtx = { msgs: [], cmd: null, via: "rule", en: null, redact: false, chained: !!opts.chained, skip: false };
    const t0 = performance.now();
    let err = null;
    try { await handleCore(raw, ctx); } catch (e) { err = e; }
    await sleep(60);
    const entry = finishLog(raw, ctx, performance.now() - t0, err);
    if (cmdCtx === ctx) cmdCtx = null;
    return entry;
  }

  async function handleCore(raw, ctx) {
    heardEl.textContent = `Heard: "${raw}"`;
    wake(); // show what was heard even for commands (like scrolling) that print no status of their own
    // Hindi and Hinglish ("doosra result kholo", "नीचे स्क्रॉल करो") become the English command; English passes through as is
    const en = VoiceNavParser.toEnglish(raw);
    ctx.en = en;
    if (en !== raw) heardEl.textContent += ` → "${en}"`;
    let cmd = VoiceNavParser.parse(en);
    if (!cmd && ctx.chained) cmd = { type: "clickText", text: norm(en) }; // "...and then chat": the second step is a name to click
    // With numbers on screen, just saying the number ("five", "14") clicks it
    if (!cmd && numbersOn && items.length) { const n = VoiceNavParser.toNumber(en.replace(/^(?:number|no\.?)\s+/i, "").trim()); if (n !== null && n >= 1 && n <= items.length) cmd = { type: "clickNumber", n }; }
    ctx.cmd = cmd;
    const act = document.activeElement;
    if ((dictating && ((dictating.el && secret(dictating.el)) || (act && secret(act)))) ||
        (act && secret(act) && cmd && ["type", "fillOrType", "typeNumber", "typeEmail"].includes(cmd.type)) ||
        (cmd && (cmd.type === "fill" || cmd.type === "fillOrType") && /passw|passcode/i.test(cmd.field))) {
      heardEl.textContent = "Heard: (hidden, it is for a password)";
    }
    if (!cardEl.hidden && !(cmd && ["help", "readResults", "hideCard", "close", "lang"].includes(cmd.type))) hideCard();
    // Dictation: anything that isn't a control command is typed as it was said (not translated, not interpreted)
    if (dictating) {
      const control = cmd && (DICTATION_CONTROLS.has(cmd.type) || (cmd.type === "send" && cmd.text == null) || (cmd.type === "confirm" && pending));
      if (!control) { ctx.redact = true; return dictate(raw); }
    }
    if (cmd && REPEATABLE.has(cmd.type)) lastRepeat = cmd;
    // A bare "stop" or "pause" ends a voice scroll before it pauses any video
    if (auto && ((cmd?.type === "media" && cmd.kind === "pause") || cmd?.type === "halt")) return stopAutoScroll(true);
    // Anything except scroll controls and panel layout takes over from a running scroll
    if (!(cmd && ["autoScroll", "scrollMore", "scrollSpeed", "stopScroll", "movePanel", "panel", "numbers", "lang"].includes(cmd.type))) stopAutoScroll(false);
    if (cmd && cmd.type !== "confirm") pending = null;
    // Right after a dropdown was named, whatever you say next picks one of its options ("price low to high")
    if (lastSelect && Date.now() - lastSelect.at < 20000 && (cmd === null || cmd.type === "clickText")) {
      const sel = lastSelect.el;
      lastSelect = null;
      if (document.contains(sel) && chooseOption(sel, cmd ? cmd.text : raw)) return;
    }
    // Right after "search": whatever is said next is the thing to search for
    // (only while a search box is really there: "search" then Escape must not leave the next sentence typed into nothing)
    if (awaitingFresh() && !visibleBoxes().some(isSearchy) && !(awaiting.el === null && Date.now() - awaiting.at < 1200)) awaiting = null;
    if (awaitingFresh() && cmd === null) { ctx.redact = true; ctx.cmd = { type: "searchText" }; return typeAwaiting(raw); }
    if (cmd) awaiting = null;
    if (cmd) {
      if (cmd.type === "clickText" && !clickByText(cmd.text, cmd.navigate)) return askAI(en); // the backend understands English only
      if (cmd.type !== "clickText") return execute(cmd);
      return;
    }
    return askAI(en);
  }

  async function refreshAIStatus() {
    try {
      const h = await chrome.runtime.sendMessage({ type: "health" });
      aiEl.textContent = h?.ok ? "AI on" : "AI off";
      aiEl.classList.toggle("up", !!h?.ok);
    } catch { aiEl.textContent = "AI off"; }
  }
  refreshAIStatus();
  setInterval(refreshAIStatus, 15000);

  // ---------- offline speech (Whisper through the local backend) ----------
  // The page listens to the microphone itself, cuts the stream into phrases wherever you pause, and sends each phrase to the
  // backend. No cloud, works in browsers without Chrome's speech service, and takes a custom vocabulary on the backend.
  let useWhisper = false, wh = null;
  try { chrome.storage.local.get("useWhisper").then((o) => { useWhisper = !!o.useWhisper; if (useWhisper && listening) startRecognizer(); }); } catch { /* no storage */ }
  const HALLUCINATIONS = /^(?:you|thank you\.?|thanks for watching\.?|bye\.?|\.+|um+|uh+)$/i; // what Whisper "hears" in silence

  const toBase64 = (buf) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

  async function sendClip(blob) {
    if (blob.size < 2500) return; // a click or a cough
    say("Thinking...");
    let r;
    try { r = await chrome.runtime.sendMessage({ type: "stt", audio: toBase64(await blob.arrayBuffer()), lang: lang === "hi-IN" ? "hi" : "en" }); }
    catch { return say("Extension was reloaded. Refresh this page"); }
    if (!r || r.error) {
      return say(r?.error === "not-installed" ? "Offline speech isn't installed: pip install -r backend/requirements-whisper.txt, then restart the backend"
        : r?.error === "timeout" ? "Offline speech took too long" : "The backend is offline, so offline speech can't work");
    }
    const text = (r.text || "").trim();
    if (TEST_HOOK) host.dataset.sttLast = text;
    if (!text || HALLUCINATIONS.test(text)) return say("Listening...");
    handle(text);
  }

  async function startWhisper() {
    if (wh || !listening || document.hidden || speakingNow) return;
    wh = { stopped: false };
    const me = wh;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { if (wh === me) wh = null; setListening(false, { remember: false, quiet: true }); return say("Microphone blocked. Click the lock icon in the address bar and allow it"); }
    if (me.stopped || wh !== me) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ac = new AudioContext();
    const an = ac.createAnalyser(); an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const START = 0.015, END_SILENCE = 750, MAX_MS = 9000;
    let recorder = null, chunks = [], began = 0, lastLoud = 0;
    Object.assign(me, { stream, ac });
    const finish = () => {
      const r = recorder; recorder = null;
      if (r && r.state !== "inactive") r.stop();
    };
    const tick = () => {
      if (me.stopped) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length), now = performance.now();
      if (rms > START) {
        lastLoud = now;
        if (!recorder && !speakingNow) {
          chunks = []; began = now;
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
          const mine = recorder;
          recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          recorder.onstop = () => { if (!me.stopped) sendClip(new Blob(chunks, { type: mine.mimeType || "audio/webm" })); };
          recorder.start();
          if (!dictating) say("Hearing you...");
        }
      }
      if (recorder && (now - lastLoud > END_SILENCE || now - began > MAX_MS)) finish();
      me.raf = requestAnimationFrame(tick);
    };
    me.finish = finish;
    me.raf = requestAnimationFrame(tick);
    if (TEST_HOOK) host.dataset.whisper = "on";
  }
  function stopWhisper() {
    const w = wh; wh = null;
    if (!w) return;
    w.stopped = true;
    cancelAnimationFrame(w.raf);
    try { w.stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { w.ac?.close(); } catch { /* closed */ }
    if (TEST_HOOK) host.dataset.whisper = "off";
  }

  // ---------- speech ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // `listening` is what the user asked for. `rec` is the browser's recognizer, which is stopped while the tab
  // is hidden (so background tabs never act on speech) and restarted when the tab is shown again.
  let rec = null, listening = false;

  function startRecognizer() {
    if (!listening || document.hidden || rec || speakingNow) return;
    if (useWhisper) return startWhisper();
    rec = new SR();
    rec.lang = lang; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 5;
    if (TEST_HOOK) { host.dataset.recLang = rec.lang; host.dataset.recStarts = String(+(host.dataset.recStarts || 0) + 1); }
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        // While dictating, every word is text: take the best guess. Otherwise prefer the first guess that is a command.
        const alts = [...e.results[i]].map((r) => r.transcript);
        handle(dictating ? alts[0] : VoiceNavParser.bestAlternative(alts));
      }
    };
    rec.onerror = (e) => {
      if (e.error === "network") say('Chrome\'s speech service can\'t be reached (offline, or Brave blocks it). Say "use offline speech" if the backend has Whisper');
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        // Blocked on this site only: turn voice off here without switching it off for every other site
        setListening(false, { remember: false, quiet: true });
        say("Microphone blocked. Click the lock icon in the address bar and allow it");
      }
    };
    rec.onend = () => { rec = null; if (listening) setTimeout(startRecognizer, 300); }; // it stops after silence; keep going
    try { rec.start(); } catch { rec = null; }
  }
  function stopRecognizer() { stopWhisper(); const r = rec; rec = null; if (r) { r.onend = null; try { r.stop(); } catch {} } }

  function setListening(on, { remember = true, quiet = false } = {}) {
    if (on && !SR && !useWhisper) { say('Speech recognition isn\'t supported in this browser. Use the offline recogniser: it needs the backend'); return; }
    listening = on;
    micBtn.classList.toggle("on", on);
    if (!on) { stopRecognizer(); setAsleep(false); micBtn.classList.remove("asleep"); }
    if (remember) try { chrome.runtime.sendMessage({ type: "setVoice", on }); } catch {}
    if (on) startRecognizer();
    if (!quiet) say(on ? "Listening..." : "Voice off. Press Alt+V");
  }

  // The background worker holds the one "voice is on" setting for every tab. Follow it whenever this page loads or becomes
  // visible, and when it announces a change, so "stop listening" in one tab can't be undone by switching to another.
  async function syncVoice() {
    try {
      const s = await chrome.runtime.sendMessage({ type: "getVoice" });
      if (!s || !!s.on === listening) return;
      setListening(!!s.on, { remember: false, quiet: true });
      say(s.on ? "Listening..." : "Voice off. Press Alt+V");
    } catch {}
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopRecognizer();
    else syncVoice().then(startRecognizer);
  });
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === "chainRun" && !document.hidden) { // the rest of a sentence, handed over by the tab that opened or switched to this one
        chrome.runtime.sendMessage({ type: "chainGet" }).then((r) => { if (r && r.parts && r.parts.length) runChain(r.parts); }).catch(() => {});
      }
      if (m?.type === "voiceChanged" && !!m.on !== listening) { setListening(!!m.on, { remember: false, quiet: true }); say(m.on ? "Listening..." : "Voice off. Press Alt+V"); }
    });
  } catch {}
  syncVoice(); // every page load (reload, navigation, a new tab) picks up where the session left off

  micBtn.addEventListener("click", () => setListening(!listening));
  addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "v") { e.preventDefault(); setListening(!listening); }
    if (e.key === "Escape" && !cardEl.hidden) hideCard();
  }, true);

  if (TEST_HOOK) {
    // Test-only: lets a live-site test see what the extension considers clickable (this block is dead code when shipped)
    document.addEventListener("voicenav-dump", (e) => {
      const q = String(e.detail || "").toLowerCase();
      scan();
      host.dataset.dump = JSON.stringify(items.map((it, i) => ({ n: i + 1, label: it.label, hint: hintOf(it.el), tag: it.el.tagName, id: it.el.id, role: roleOf(it.el) }))
        .filter((x) => !q || x.label.toLowerCase().includes(q)));
    });
    let n = 0;
    document.addEventListener("voicenav-command", async (e) => {
      try { await handle(String(e.detail)); } finally { host.dataset.handled = String(++n); }
    });
  }
})();
