# Trying VoiceNav: guide for a first-time tester

VoiceNav is a Chrome/Edge extension that lets you browse by voice ("scroll down", "click add to cart", "search for headphones").
It works in two levels:

- **Level 1, extension only (2 minutes):** scrolling, clicking by name, tabs, typing, search, numbers, media controls.
- **Level 2, plus the AI backend (15-30 minutes, optional):** flexible phrasing such as "open the cheapest one". Needs Python and Ollama.

Start with Level 1. If it works for you, add Level 2 only if you want to.

## What you need
- **Google Chrome or Microsoft Edge** on a computer. Brave, Firefox and Safari do not work.
- A **microphone** and an internet connection (Chrome's speech recognition sends audio to Google).
- The `extension` folder (or the zip) from the person who sent you this.

## Level 1: install the extension
1. If you received a zip, **right-click > Extract All** to a folder you will keep (for example `Documents\voicenav-extension`).
   Do not delete or move this folder later: Chrome loads the extension from it.
2. Open Chrome and go to `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode** (switch at the top right).
4. Click **Load unpacked** and pick the folder that contains `manifest.json` (not a folder above it).
5. VoiceNav now appears in the list. It has no toolbar button: the pill on the page is the control.
6. **Open any normal website** (for example `https://www.wikipedia.org`). Extensions do not run on `chrome://` pages or the Chrome Web Store.
   Reload tabs that were already open before installing.
7. A small **pill / mic icon** appears on the page (already-open tabs get it too, no refresh needed). Click it, or press **Alt+V**. The first time, a VoiceNav tab opens and Chrome asks to use the microphone: choose **Allow** (if it offers "Allow this time", pick "Allow while visiting the site" instead). You do this once; no website asks again.
8. Say **"what can I say"** to hear/see the list of commands.

### Things to try
| Say | What happens |
|---|---|
| "scroll down", "scroll up a little" (or "scroll a little up"), "go to the top" | scrolling; small spelling slips like "scrol dwn" are forgiven |
| "show numbers", then "click 5" | numbers every clickable thing; click by number |
| "click sign in", "click add to cart" | click by the visible name |
| "search for headphones" | uses the page's search box |
| "new tab", "next tab", "previous tab", "go back" | tabs and history |
| "type hello", "send" | types into the focused box |
| "pause", "play", "mute" | video/audio |
| "describe this page" | spoken tour of the page |
| "move the voice icon to the top right" | moves the pill |
| "undo", "stop listening" | takes back / stops |

### "VoiceNav is debugging this browser" banner
Seen briefly on some clicks. VoiceNav uses it to send a real, trusted click when a normal one is ignored by a website.
It disappears by itself. Nothing is recorded or sent anywhere.

## Level 2 (optional): the AI backend for flexible phrasing
Without it, the extension still works; commands it cannot parse just say "AI backend offline".

1. Install **Python 3.11+** (python.org; tick "Add to PATH") and **Ollama** (ollama.com).
2. Open PowerShell and run: `ollama pull qwen2.5:3b` (about 2 GB).
3. In the project folder (the one with `start-backend.ps1`) run: `./start-backend.ps1`.
   The first run creates a virtual environment and installs the requirements. It then listens on `http://127.0.0.1:8000` (this PC only).
4. Leave that window open. Reload the extension at `chrome://extensions` and try "open the cheapest one" on a shopping site.

Optional offline speech (Whisper): `pip install -r backend/requirements-whisper.txt` inside the virtual environment, restart the backend,
then say "use offline speech". `use chrome speech` switches back.

## If something does not work
| Problem | Fix |
|---|---|
| No pill on the page | Reload the tab; make sure the extension is on at `chrome://extensions`; not a `chrome://` page |
| Pill appears but nothing is heard | Press **Alt+V** twice. If a VoiceNav tab opens, press its button and choose Allow. Also check Windows microphone privacy settings |
| "not-allowed" / mic error | The permission was blocked for VoiceNav: open the browser's microphone settings, take VoiceNav off the blocked list, then press Alt+V twice. Another app using the mic can also cause it |
| Updated the extension and a tab misbehaves | Click the reload arrow on VoiceNav at `chrome://extensions`; open tabs pick it up by themselves |
| Words misheard | Speak in short, plain phrases; say "show numbers" and "click 7" instead of long names |
| "AI backend offline" | Normal in Level 1. For Level 2, check `start-backend.ps1` is running and Ollama is open |
| Works in Chrome, not in Brave | Brave blocks Google's speech service; use Chrome or Edge |

## Known limits
- Chrome and Edge only; needs internet for Chrome's speech recognition (unless you set up Whisper).
- Google Docs typing/rename and the Gemini panel are still being verified on the real site.
- It is a test build: do not use it for payments or anything irreversible while testing. It asks before obvious risky buttons, but treat it with care.

## Send feedback
Say **"show failed commands"** after something fails and send the lines it shows, plus the website and what you said.
