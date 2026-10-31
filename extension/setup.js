// The one place VoiceNav asks for the microphone. The permission belongs to the extension, not to a website, so answering
// it here covers every site; the offscreen page (offscreen.js) can't show the question itself, which is why this page exists.
const msg = document.getElementById("msg"), go = document.getElementById("go");

function show(state, text) {
  document.body.dataset.state = state;
  msg.textContent = text;
  go.hidden = state === "asking" || state === "granted";
}

async function ask() {
  show("asking", "Chrome is asking to use your microphone. Choose Allow.");
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    if (e?.name === "NotFoundError") return show("nomic", "No microphone was found. Plug one in, then press the button.");
    return show("blocked", "The microphone is blocked for VoiceNav. Open your browser's microphone settings, move VoiceNav out of the blocked list, then press the button.");
  }
  show("granted", "All set. VoiceNav can use your microphone on every site. This tab closes by itself.");
  chrome.runtime.sendMessage({ type: "micGranted" }).catch(() => { /* the worker is restarting; it asks again when it needs the microphone */ });
  if (location.hash !== "#keep") {
    setTimeout(() => chrome.tabs.getCurrent().then((t) => t && chrome.tabs.remove(t.id)).catch(() => window.close()), 2500);
  }
}

go.addEventListener("click", ask);
// Someone who unblocks the microphone in the browser's settings doesn't need to press anything
navigator.permissions?.query({ name: "microphone" }).then((p) => {
  p.onchange = () => { if (p.state === "granted" && document.body.dataset.state !== "granted") ask(); };
}).catch(() => { /* no permissions API */ });
ask();
