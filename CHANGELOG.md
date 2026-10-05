# Changelog

## 0.3.0 (2026-10-05/06): fixes from hands-on use, real clicks, offline speech, a guided tour

Starting point (0.2): 758 unit tests, 47 backend tests, 157+41+83+66 browser checks, all passing, yet hands-on use on YouTube and Google
Docs turned up a list of bugs the tests didn't cover. This release fixes those, adds the features planned after them, and tests on
the sites most used in India.

### Bugs found by using it, and what was done

| Bug | Cause | Fix | Check |
|---|---|---|---|
| "click snacks and treats" on Amazon Now: "I'm not sure what you meant" | the page label "Snacks & treats" had its `&` stripped, so it never matched "and" | `&` is read as "and" on both sides (`content.js` `norm`) | e2e unchanged (157 pass) |
| "scroll down a little" scrolled a full screen | only "a little bit" was recognised; the rest fell through to plain scroll | small-scroll phrases (`a little`, `just a little`, `a tad`...) | unit tests |
| "go back to the previous tab", "go to the first tab that is open" not understood | patterns had no "back to" and no trailing "that is open" | tab patterns widened, plus `1st`..`5th`, `last tab` | unit tests |
| "pause" did not stop a voice scroll (but "stop" did) | the recogniser hears "paws"/"pores"; the handler itself was right | those mishearings, `wait`, `hold on` map to pause | unit tests |
| Share > WhatsApp "clicked" but nothing opened | scripted clicks can't open popups | share links are opened as tabs through the extension | unit; real-site check left to you |
| "comment on the video", "the three dots" failed on YouTube | no command; many "More actions" buttons matched | `comment` command; the video's own menu is preferred; site pack | unit; mock only |
| Typing in Google Docs went to the title / the Gemini panel | Docs types through a hidden iframe the extension couldn't see, so "type" fell back to the first text box | editor iframe lookup; `type` never falls back to the title in Docs; "in the document / title / Gemini" targets; `rename ...` | unit; needs your Docs login to verify |
| "show numbers" then "click 14" did nothing on some sites | VoiceNav sent a bare click event; pages that react to mouse down/up ignore it | full pointer sequence on every click; a real-click fallback (below) | `e2e-trusted.mjs` |

### New

- **Real clicks** (Chrome debugger, attached per click): automatic for menu openers that changed nothing; on a repeated request for
  anything else; never for links, text boxes, toggles or buy/send/delete-type buttons. While building it, a test caught a button being
  pressed twice (the change watcher started too late) and a click being lost when the target was under VoiceNav's own pill; both fixed.
- **Virtual pointer** that glides to the target and ripples.
- **Genuine key presses**: `press control shift s`, `press the tab key`, arrows, page up/down. `start voice typing` uses it for Docs.
- **Speech alternatives**: the first of Chrome's five guesses that is a command wins.
- **Offline speech (Whisper)**: microphone -> pause detection -> backend `faster-whisper` -> command. English `base.en` with a vocabulary
  prompt, Hindi `base`. `use offline speech` / `use chrome speech`; backend `/stt` status, `/transcribe?lang=`, optional preload.
- **Guided tour** (`describe this page`) and **spoken replies** (`speak replies`), with the microphone paused while speaking.
- **Per-site packs** (`extension/sites.js`): YouTube, Google Docs, Gmail, Amazon, as editable data with "what can I say" tips.
- **Move the pill by natural phrases**: "move the voice icon to the top right".
- Docs test harness with a separate login profile (`tests/live-docs.mjs`), `npm run` scripts, `CHANGELOG.md`.

### Results

| Suite | Before | After |
|---|---|---|
| Unit tests (`npm test`) | 758 | 788 |
| Backend tests | 47 | 52 |
| Browser: e2e / forms / chat / browse | 157 / 83 / 41 / 66 | 157 / 83 / 41 / 66 |
| Browser: real clicks, keys, tour | n/a | 17 |
| Browser: spoken phrase -> Whisper -> scroll | n/a | 4 |
| Detector | 33 | 33 |
| Top Indian sites (14, logged out, `live-india.mjs`) | not run | 72 of 74 |
| Whisper on 4 spoken test phrases | not wired | 4 of 4 correct, ~1.8 s each on CPU |

Indian-sites misses: Flipkart (a login popup covers the page and one clickable text, "Use Email-ID", is not numbered) and one Myntra
timing flake (passed 3 of 3 when rerun alone).

### Not done, and why

- **Vision model for unnamed icons**: needs a large model download and screenshot access; not worth the weight for a placement demo.
- **Real Google Docs and Gemini verification**: needs a signed-in account; run `tests/live-docs.mjs` once you have logged in.
- **Real microphone speech** (English or Hindi): Whisper was tested with a synthetic voice recording only.
- **Google search**: serves a CAPTCHA to automation; not bypassed.
- Comments, share links and the Docs/Gmail/YouTube pack selectors were written from how those sites are built and tested on mock pages only.
