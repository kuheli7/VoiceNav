# Changelog

## Unreleased: the text beside the pill is a caption

| Problem | Cause | Fix | Check |
|---|---|---|---|
| A long reply or a long "Heard" line was cut to one line with "..." inside the small pill (user report) | the status and heard lines were single-line (`nowrap` + ellipsis) inside a pill that is only 420 px wide | the text is a translucent rounded caption next to the pill (above it when the pill is at the bottom, below it at the top), one plain style: same size, normal weight. It is black at 55% (it was 82%) with white text, so it reads the same on light and dark pages (worst case, a pure white page, is 4.7 to 1); a thin light edge keeps it visible on dark pages. It shows VoiceNav's reply alone when a command worked; what you said is added only when it helps: the command failed, it was translated from Hindi, or it got no reply (ignored, asleep), when it shows alone. The reply wraps to 3 lines and keeps its beginning; the "Heard" line shows its last 2 lines, the old words fading out at the top. The elements still hold the whole text (tests, screen readers; the voice log keeps only 140 + 120 characters, as before); clicks pass through the caption; it follows the pill when moved, hidden or shrunk; reduced-transparency, high-contrast and reduced-motion settings are respected. The limits are two CSS variables, `--status-lines` and `--heard-lines` | `e2e.mjs` (+11: four corners, click-through, see-through, one style, whole text kept, short line unfaded, and when the heard line shows: worked, failed, ignored, Hindi); screenshots on white, dark and busy pages, at 1000 px and 360 px wide, English and Hindi |

## 0.4.0 (2026-10-31): the microphone is asked once for the whole extension, not once per website

| Problem | Cause | Fix | Check |
|---|---|---|---|
| Every new website asked "Allow the microphone?", which someone who can't use a mouse can't answer | listening ran inside each page, and Chrome asks per website | a hidden extension page (`offscreen.html` / `offscreen.js`, new `offscreen` permission) does the listening; the extension's own address is asked once on `setup.html`, which opens by itself the first time. Speech goes to the tab in front only; the microphone pauses while VoiceNav speaks; where there are no offscreen pages the tabs listen for themselves as before | `tests/e2e-mic.mjs` (25), no `--use-fake-ui-for-media-stream` so a prompt would show as a stall |
| (found by that test) the pill kept saying "Listening..." when the microphone was not allowed | the worker opened the setup tab before telling the tab in front, so the message went to the setup page | tell the tab first, then open setup | e2e-mic |
| (found by review) the shared microphone would have stayed open with Chrome minimised or covered, which the old per-tab code never did | the offscreen page has no visibility of its own | tabs report whether they can be seen; the microphone is open only while voice is on and a tab can be seen. The stop waits a second so a tab switch doesn't restart it; reports carry a time so a page being left can't overrule the page that replaced it | e2e-mic |
| "can you please open a new tab and search for hello" failed (user report) | only "then" / "and then" / "after that" separated commands, so the whole sentence was taken as one click on text "a new tab and search for hello" | a plain "and" also separates when the first part is a whole command (not typing or searching, which take free text) and the rest is a command or starts with a command word; "click salt and pepper", "open black and white", "search for cats and dogs" stay whole | unit (+2), `e2e-browse` (+1: the second half runs on the page the first half opened); live spike: new tab, then the search for "hello" was submitted (Google then showed its bot check, which is not worked around) |
| (found by review) Whisper in the shared page might have captured silence | the page never gets a click, and a suspended `AudioContext` gives the analyser zeros | the page reports the context's state; `e2e-whisper` checks it is `running` | e2e-whisper |

Also: after the one-time permission the pill says "Listening..." again; the "last window" memory survives the worker being stopped; manifest has a
`key` only in the test copies (the shipped manifest is unchanged apart from version 0.4.0 and the `offscreen` permission).

Checks: unit 807, `e2e.mjs` 113 with the AI backend off (157 with it on: its 44 AI cases are skipped otherwise; 0.4.0 as released, before the caption), `e2e-mic.mjs` 25, forms 83, chat 41, browse 67, trusted 17, reload 7, `e2e-whisper.mjs` 5, all passing.

**Not verified (needs a real microphone and browser):** a real click on Chrome's Allow persisting for the extension's address (the tests
write the grant into a test profile); what "Allow this time" does once the setup tab closes; Chrome's speech service transcribing real
speech from the extension page (a fake microphone gives no transcript); a real minimised window (a Playwright browser never reports a tab
as hidden, so the tests make the tabs' reports by hand); Edge. Google Docs voice typing now switches voice off for every tab while the shared
microphone is in use. Someone with no hands still needs a helper for the very first "voice on" and the one-time Allow.

## 0.3.1 (2026-10-24): fixes from the first outside tester

| Feedback | Cause | Fix | Check |
|---|---|---|---|
| "Why do I have to refresh the page every time?" | browsers add content scripts only to pages loaded after the install or reload, so every open tab needed a refresh | the service worker injects the scripts into all open http(s) tabs on install/update/reload (`scripting` permission); a copy left from before a reload hands over to the new one, so there is never a second pill or microphone | `tests/e2e-reload.mjs` (7) |
| "scroll a little up" is not "scroll up a little" | only one word order was parsed | both orders for little/bit/slightly/a lot | unit |
| The voice icon moves only if the sentence starts with "move" | verb was required | verb optional ("voice icon to the top left", "mic bottom right"), bare "top right" works | unit |
| One wrong letter breaks a command | exact patterns only | misspelled command words (one edit, two for long words) are repaired, only for harmless commands (scroll, tabs, media, pill, back/forward...), never for click/search/type | `tests/tolerance.test.js` (17) |

Manifest version 0.3.1 now matches; unit tests 805. Not changed: speed (still to be measured).

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
