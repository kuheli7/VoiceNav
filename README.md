# VoiceNav

Hands-free web browsing for people who can't use a mouse or keyboard. A Chrome/Edge extension that lets you say
"scroll down", "click add to cart" or "open the cheapest one" and have the page do it, with a local AI model
(no cloud, no API cost) for commands that aren't fixed phrases.

## How it works

```
 Mic -> Chrome speech recognition -> text
                                      |
              +-----------------------+------------------------+
              | extension (JavaScript)                         |
              |  1. parser.js: fixed commands, instant         |  "scroll down", "click 14", "search for X"
              |  2. no match -> page scan: visible elements    |
              |     with role, label (ARIA), price             |
              +----------------------+-------------------------+
                                     | via background service worker
                                     v
              +------------------------------------------------+
              | backend (Python, FastAPI, localhost only)      |
              |  3. resolver: "second result", "cheapest"      |  exact, 0 ms
              |  4. LLM (Ollama, qwen2.5:3b): pick a label     |  ~1-2 s on CPU
              |  5. validator: reject anything not on the page |
              +----------------------+-------------------------+
                                     v
                        {action: click, id: 7}  ->  extension clicks it
```

Design decisions worth knowing:

- **Rules first, LLM last.** Most commands are fixed phrases and cost nothing. The LLM only sees what rules can't handle.
- **Code does the counting.** A 3B model is bad at "second" and "cheapest" (see results), so `resolver.py` does them from the
  element list and extracted prices.
- **The model copies a label, not a number.** The JSON schema's `enum` is built from the labels on the page, so it
  can't name an element that doesn't exist. Switching from numeric ids to this was the biggest accuracy gain.
- **Never trust the model.** `validate()` drops unknown targets, empty text, and typed text containing words the user
  didn't say.
- **"Result" means a result.** A product or video card holds several links (image, title, channel, ratings). On Amazon and
  YouTube the extension marks each card's main link and sends the card's own price, so "the second result" and "the cheapest"
  count products, in page order, including ones below the fold. Other sites fall back to a guess that is less reliable.
- **"Open" follows links.** `open ...` never matches Add-to-cart/Buy/Subscribe buttons, on the extension side or in the AI's answer.
- **Safety.** Clicking anything labelled like *buy now / pay / delete / log out / subscribe* needs a spoken "yes".
- **Accessibility-tree based.** Elements are named from `aria-label`, `aria-labelledby`, `<label>`, visible text, `alt` and
  `placeholder` (what screen readers use), not from site-specific selectors, so it isn't tied to one website.
- **Local only.** The backend binds to `127.0.0.1`, has no CORS, and is reached only through the extension's service worker.

## Run it

**Prerequisites:** Chrome or Edge, Python 3.11+, [Ollama](https://ollama.com) with `ollama pull qwen2.5:3b`.

1. **Load the extension:** `chrome://extensions` -> Developer mode -> Load unpacked -> choose the `extension` folder.
2. **(Optional) start the AI backend:** `.\start-backend.ps1`. The pill's badge turns green ("AI on").
3. Open any site, press **Alt+V**, allow the microphone, and speak.

### Commands that work without the backend

| Say | Does |
|---|---|
| `scroll down` / `scroll up a bit` / `scroll down a lot` | Scroll |
| `go to the top` / `go to the bottom` | Jump |
| `scroll down slowly` / `scroll up fast` / `keep scrolling` | Scroll continuously until you say `stop` (`faster` / `slower` adjust it). Works on pages that scroll inside a panel too. If your browser splits it into "scroll down" and "slowly", the "slowly" continues the scroll. Touching the mouse or keyboard also stops it |
| `close` / `close this popup` / `press escape` | Close the open popup or dialog |
| `move panel to the top left`, `hide panel`, `show panel` | Move or hide the control pill when it covers something |
| `go back` / `forward` / `refresh the page` | Navigation |
| `show numbers` then `click 14` | Number overlay on every clickable element. Anything hidden behind an open popup is skipped |
| `sort by price low to high` | Pick that option in a page's sort dropdown (also works when the page hides the real dropdown). `sort by` alone lists the options; the next thing you say picks one |
| `click the second question` / `open the third result` / `view the first item` | Position words count from the **first result you can see**, so after scrolling "the first one" is the first on screen. Nouns matter: "question" counts questions, "result" counts results |
| `open the cheapest one` / `I'd like to see the most expensive item` | Price comparisons look at every result on the page |
| `view the item` | Ambiguous, so it asks "Which one?" and shows numbers |
| `click add to cart` | Click by label (asks you to pick a number if ambiguous) |
| `search for wireless headphones` | Fill the page's search box and submit |
| `type hello world`, `clear the text`, `submit` / `press enter` | Text entry. With nothing focused, `type` goes to a chat's message box if the page has one, else the first text box. `submit` presses the box's own submit button if there is one (chat editors ignore a simulated Enter key) |
| `send` / `send it` / `send message` / `press send` / `submit message` | Chat sites: press the message box's Send button. It waits up to 2 s for the button to become enabled (or appear) after typing, never presses voice/dictation/attach buttons, and says "Sent", "The message box is empty" or "Couldn't find a send button" |
| `type what is 2 plus 2 and send it` / `send what is 2 plus 2` / `ask Claude what is 2 plus 2` | Type into the chat's message box (not a search field), then send. Instant: no AI round trip |
| `pause` / `play` / `mute` / `unmute` | Media |
| `close` / `close this popup` / `press escape` | Close the open popup (native dialog, a Close button, or the Escape key) |
| `yes` / `cancel` | Answer a confirmation |
| `stop listening` | Mic off completely |
| `go to sleep` / `wake up` | Ignore everything until you say "wake up" |
| `what can I say` / `help` | A card listing what you can say **on this page** (results, sorting, chat box, video...). `close` hides it. Hindi: `madad` |
| `undo` / `undo that` / `take that back` | Presses the page's own Undo button if it has one (Gmail's, an editor's). Otherwise reverses your last action: typing (even twice), a scroll, a switch or checkbox (only if the page hasn't changed it since), a dropdown choice, going back or forward, and a page a click opened: said in the new tab it closes that tab and returns you; said in the old tab it closes the one that click opened. It says plainly when it can't: Add to cart, a sent message, a purchase, and any button that submits a form are not undone. Hindi: `undo karo` |
| `read the results` / `what's on the screen` | Lists the first results on screen on a card, numbered, with prices. Hindi: `results padho` |
| `use wake word` / `always listen` | Require "Nova" or "Computer" before each command, or not |

### Typing and forms

Fields are found by the name a person would give them (their label, placeholder or aria-label), never by position, so it works on
forms VoiceNav has never seen. No backend needed.

| Say | Does |
|---|---|
| `fill first name with Asha` / `set the city to Pune` / `type Asha in last name` | Fills that field. Case is kept. If two fields match equally ("name" with First and Last name) it asks instead of guessing |
| `fill phone with nine eight seven six five four three two one zero` | Spoken digits become a number (`double nine`, `triple`, `plus nine one`, `twenty five`). Text that isn't a number is refused, not typed |
| `fill email with asha dot sharma at gmail dot com` | Becomes `asha.sharma@gmail.com` (also "at the rate") |
| `fill date of birth with 5th of March 1999` | Date inputs get 1999-03-05; an impossible date (31 February) is refused |
| `fill country with India` / `fill gender with female` | Picks a dropdown option or a radio button by name |
| `tick the newsletter checkbox` / `untick terms` / `tick female` | Checkboxes, switches, radio buttons. Says if it is already so |
| `type email ...`, `type number ...`, `type date ...` | Same conversions, into the box you are in |
| `next field` / `previous field` / `list fields` / `read this field` | Move through the form; list every field with its state on a card; hear what a field holds |
| `start dictation` ... `stop dictation` | Everything you say is typed, with spoken punctuation: `comma`, `full stop`, `question mark`, `new line`, `new paragraph`, `open quote`... and capitals. While dictating only control phrases (stop dictation, next field, delete last word, undo, send) are commands; "go", "click submit" and the like are typed as words. A **Dictating** chip shows, and it switches off by itself after 2 minutes of silence |
| `delete last word` / `delete last sentence` / `delete that` / `backspace` / `select all` / `new line` | Edit the box you are in. `delete that` removes only what was just typed, and leaves the box alone if it has changed since |
| `repeat` | Say the last move, edit or scroll again |

Hindi/Hinglish: `dictation shuru karo`, `agla field`, `fields dikhao`, `phir se`, `last word hatao`, and dictating Hindi with
`purn viram`, `kama`/`कॉमा`, `प्रश्न चिह्न` (see forms tests).

Safety and honesty:
- A form is **never submitted** by any of these commands (a submit button needs an explicit click or `submit`; dictation treats it as text).
- Passwords can be filled, but are never shown in the status, the field list or read back, and the "Heard" line is hidden while one is the target. Dictating into a password box types it exactly as said (no capitals or punctuation words).
- Hidden spam-trap fields (transparent, parked off-screen, clipped away, inside a transparent parent), disabled and read-only fields are never listed or filled.
- Everyday speech is not hijacked: `type i live in delhi` types the sentence (no field called delhi); `set the volume to 50`, `put this in my cart` go on to the AI when no field matches; `write email to my boss...` is typed as text when it isn't an address.
- A field with `maxlength` gets what a keyboard would let in, and it tells you. A field whose page changes what you typed is reported ("the page shows ...").
- Everything typed has an undo, including a clear and a radio choice.
- Not handled: time/week/month inputs, custom dropdowns drawn with divs, canvas editors, CAPTCHAs. `set` / `clear` only reach a form field that exists. Spoken "colon", "hyphen", "new line" are always punctuation while dictating (like other dictation tools).

### Tabs, other sites, video, the log

| Say | Does |
|---|---|
| `open youtube` / `go to gmail` / `open amazon in a new tab` / `open example.com` | Opens another site by name (about 45 known ones, or any plain address). If this page has a link with that name (YouTube's own logo, an Amazon result) that is pressed instead. `undo` goes back, or closes the new tab |
| `new tab` / `next tab` / `previous tab` / `switch to the second tab` / `switch to gmail` | Tabs. Voice follows you to the new tab. A browser page (chrome://, the Web Store) can't be listened in, so it is never switched to without saying so, and `new tab` opens Google |
| `list tabs` / `close this tab` / `reopen closed tab` | See them on a card; close one; bring one back |
| `open the project and then chat` | Several commands in one sentence (`and then`, `then`, `after that`). Waits for the page to settle between steps; if a step loads another page the rest carries on there. The second step prefers the button that **appeared** after the first. Stops, and says so, if a step fails. Sentences that type text ("type first this then that") are never split |
| `speed 1.5` / `double speed` / `normal speed` / `make the video faster` / `faster` | Playback speed (a bare `faster` means the video when one is playing and nothing is scrolling) |
| `skip 10 seconds` / `rewind 30 seconds` / `go to 2 minutes` / `restart` | Seek |
| `like` / `dislike` / `subscribe` / `skip ad` / `next video` / `captions on` / `theater mode` | YouTube-style controls; the like button of the **video**, not a comment's. `subscribe` asks for a spoken yes. A like that needs a sign-in says so instead of claiming success |
| `open the mini player` / `close the mini player` | The small player in the corner YouTube leaves when you navigate away |
| `full screen` / `exit full screen` | Browsers refuse real full screen unless a person pressed something. It tries, and if refused says so and makes the window full with theater mode instead |
| `scroll down the recent chats` / `scroll up the sidebar` / `scroll up the right side` | Scrolls that part of the page (left and right edge panels, the middle). If there is nothing to scroll there it says so instead of moving something else. Chats that scroll upside-down (newest at the bottom) now scroll up too |
| `search` | Presses the search icon (or goes to the box) and waits: what you say next is the search. `search chats` the same |
| `click the plus icon` / `the microphone` / `the mouse` | Icons with no words on them are found by the names the site hides in its code and by synonyms (plus is add/attach, mouse and mic are dictate) |
| `open the email from Rahul` / `close the email` / `deselect all` / `select all emails` | Mail-style lists: opens (never ticks) the row, goes back to the inbox, clears or sets the selection |
| `show the log` / `show failed commands` / `clear the log` | The log (below) |

**The log.** Every command is recorded with whether it worked, on which site, and what it said back. Say `show failed commands` for a
card of the most common failures (same phrase on the same site counts once), `show the log` or the extension's Options for a page
with filters by site, counts, and download as JSON or CSV. It is stored only on this computer, up to 800 entries. What you type or
dictate is not kept, only that you did. A command counts as *failed* when it says it couldn't, as *needed help* when it had to ask
which one you meant; a warning that arrives a second later ("the page didn't change it") also marks it failed.

Honest limits: a new site asks for microphone permission once (Chrome keeps it per site). ChatGPT and Gmail need a login, so they are
tested on mock pages built from what I know of their layout, not on the real sites: the icon-only buttons, upside-down scroll, sidebar,
and mail rows there are a best effort and the log is how a miss on the real site will show up.

### On a call or talking to someone

It listens to everything while the mic is on, so pick one of these before you start talking:

- **`go to sleep`**: ignores all speech except "wake up".
- **Wake-word mode** (`use wake word`, or the **Wake** chip on the pill): only acts on speech that *starts* with "Nova" or
  "Computer", e.g. "Nova, scroll down". Everything else is ignored and shown as "Ignored" on the pill.
- **`stop listening`** or **Alt+V**: mic fully off.

It also stops listening when you switch to another tab, and a "yes" to a purchase confirmation expires after 10 seconds.
Voice stays on across page reloads, navigation, links that open in a new tab, and switching tabs: it is one setting for the
browser session, and only the tab you are looking at ever listens. (Two browser windows side by side would both listen.)

### With the backend

`open the cheapest one`, `open the second result`, `put this in my basket`, `show me the reviews`, `go to the sports section`...

### Hindi and Hinglish

You can speak Hindi, English or a mix. Both scripts work: Devanagari (what Chrome's Hindi recognizer writes, English
loanwords included, e.g. "स्क्रॉल डाउन करो") and romanized Hinglish in its many spellings (kholo / kholiye / khol do,
dheere / dhire, doosra / dusra, sabse sasta / sabse sastha).

| Say | Means |
|---|---|
| `neeche scroll karo`, `थोड़ा नीचे`, `sabse upar jao`, `dheere dheere neeche scroll karo`, `ruko` | scroll down, a bit down, top, scroll slowly, stop |
| `peeche jao` / `wapas jao`, `aage jao`, `page refresh karo` | back, forward, reload |
| `doosra result kholo`, `तीसरा वीडियो खोलो`, `aakhri wala kholo`, `sabse sasta wala open karo`, `sabse mehnga wala dikhao` | position and price (resolved by the backend, like the English) |
| `number dikhao` / `iska number dikhao`, `paanch number dabao`, `5 नंबर पर क्लिक करो`, `number hatao` | number overlay (Hindi number words 1-50 and Devanagari digits) |
| `sign in pe click karo`, `free delivery select karo`, `add to cart karo`, `कार्ट में डालो`, `abhi kharido` (asks "yes" first) | click by name, shopping |
| `headphone search karo`, `सर्च करो हेडफोन`, `hello world likho`, `bhejo`, `namaste likh ke bhejo`, `Claude se puchho ...` | search, type, send, ask (the words are kept exactly as said, in either script) |
| `video roko`, `video chalao`, `awaaz band karo` | pause, play, mute |
| `haan` / `theek hai`, `nahi` / `mat karo` | yes / cancel |
| `popup band karo`, `so jao`, `jaago`, `wake word chalu karo`, `sunna band karo` | close, sleep, wake up, wake word, mic off |

Wake words also work in Devanagari ("नोवा", "कंप्यूटर"). A bare **`band karo`** ("turn it off") depends on what is happening:
it stops a running voice scroll, otherwise closes an open popup, otherwise pauses what is playing, otherwise presses Escape.
With a noun it is specific: `popup band karo` closes, `video band karo` pauses, `awaaz band karo` mutes, `number band karo`
hides numbers, `mic band karo` turns the mic off.

**Switching language.** Chrome's recognizer listens for one language at a time. Say `hindi mein bolo` / `हिंदी में बोलो` /
`speak hindi` or `english mein bolo` / `अंग्रेजी में बोलो` / `speak english`, or click the **EN / हिं** chip on the pill.
It is remembered, and restarts the recognizer with `hi-IN` or `en-IN`. The switch phrases work in either mode, including a
few likely mis-hearings by the English recognizer ("Hindi may bolo", "Hindi main bolo"). Hindi/Hinglish is understood in
**both** modes: in English mode you can still say "neeche scroll karo", and in Hindi mode English product names still work.

**How.** `toEnglish()` in `parser.js` turns what was said into the English command the parser already knows. Hindi puts the
verb last ("doosra result kholo" = "open the second result"), so it finds the verb (kholo, karo, jao, dikhao, roko, likho,
bhejo, dabao, dhundo...) and rebuilds the sentence verb first; it doesn't translate word by word. Spellings are compared by
a loose key ("neeche", "niche" and "नीचे" match). The AI backend gets the English form, so it needed no change.
Conversation is left alone: sentences with question words or tenses ("woh peeche baitha hai", "मैं घर जा रहा हूँ") and
unknown verbs ("mummy ko phone karo") are not turned into commands. English is never changed (every English test phrase
passes through untouched); a capitalised word mid-sentence is taken as a name, so "open Karo Tea" stays a click on "Karo Tea".

**Limits.** Nothing here was tested with real Hindi speech (no microphone): only typed text in both scripts, 302 unit tests
(`tests/hindi.test.js`), 41 browser checks on the mock pages (in `e2e.mjs`) and a short real-site run (`tests/live-hindi.mjs`, 2026-10-05:
YouTube 8/8, amazon.in 6/6). What Chrome's hi-IN recognizer actually writes varies (which words come out in Latin letters,
spellings of loanwords), so expect misses. Product names said in Devanagari ("सोनी हेडफोन खोलो") are spelt out in Latin
letters ("soni headphone") for matching, which often won't match an English label exactly; the AI may still find it.
Status messages are in English. In lower case, "open karo tea" is read as Hinglish ("open tea").

## Clicking like a person, offline speech, a guided tour (v0.3)

**Clicks.** A person's click is: pointer over, button down, button up, click. VoiceNav used to fire a bare click event, which many
sites (menus, Google's apps, custom buttons) ignore. Now every click sends the whole sequence, aimed at the middle of the element,
and an on-screen pointer glides there so you can see where it clicked. Browsers also mark scripted events as "not from a user",
which blocks popups and some widgets, so there is a fallback that sends a **genuine** mouse press through Chrome's debugger:

- **Menu openers** (`aria-haspopup` / `aria-expanded`) that visibly did nothing get a real click automatically.
- **Anything else** gets one only when you **say the same thing again** within 15 seconds (it didn't work, so try for real).
- **Never** for links (the page navigates itself), text boxes, toggles, or anything that buys, sends, deletes or subscribes: a second
  press could do it twice. A real click is skipped if something (like VoiceNav's own pill) is on top of the target.
- Chrome shows "VoiceNav started debugging this browser" for the instant it is attached (it attaches per click). `stop using real
  clicks` / `use real clicks` turns the fallback off and on.

| Say | Does |
|---|---|
| `press control shift s`, `press the tab key`, `press down arrow`, `press page down` | A genuine key press (for shortcuts the page listens for). `press tab` still means "go to the next field" and `press delete` / `press home` still click a button of that name |
| `start voice typing` | Google Docs' own dictation (Ctrl+Shift+S). VoiceNav pauses while it runs |
| `type hello in the document` / `type Trip plan in the title` / `rename the document to Trip plan` | Google Docs, Sheets, Slides: the page, the title, or the title again. With nothing focused, `type` goes to the document, never the title or the Gemini panel |
| `type hello in Gemini` | The box inside the Gemini panel (found by what it belongs to, also inside shadow DOM) |
| `comment on this video` / `add a comment` | YouTube: scrolls to the comments, opens the box and focuses it. Then `type ...`, `click comment` |
| `click whatsapp` (in YouTube's share dialog) | Opens WhatsApp / Facebook / X / Reddit / Telegram / LinkedIn / email's own share link in a new tab (a scripted click can't open a popup) |
| `scroll down a little` / `just a little` | A small scroll (0.3 of a screen; `scroll down` is 0.8) |
| `go back to the previous tab`, `go to the first tab that is open`, `last tab`, `2nd tab` | Tab phrasing |
| `pause` (also "paws", "pores", `wait`, `hold on`) | Stops a voice scroll first, then pauses the video |
| `number 5` / `five` (while numbers are showing) | Click that number |
| `move the voice icon to the top right`, `move it to the bottom left`, `move to the top left` | Moves the pill |

**Several guesses per phrase.** Chrome returns up to five transcripts for what you said. VoiceNav takes the first one that is a
command ("scroll dawn", "scroll down" -> scroll down), and keeps the top guess if none is, so a mishearing no longer costs a command.

**Offline speech (Whisper).** `use offline speech` makes VoiceNav listen to the microphone itself, cut it into phrases wherever you
pause, and send each phrase to the backend's `faster-whisper` (no cloud; works in browsers whose speech service is blocked, like
Brave). English uses `base.en` with a short vocabulary prompt ("scroll down", "add to cart"...), Hindi the multilingual `base`.
`use chrome speech` switches back. Setup: `pip install -r backend/requirements-whisper.txt` (the model downloads on first use), then
`.\start-backend.ps1` (it preloads the model). Measured here: 4 of 4 spoken test phrases transcribed correctly, about 1.8 s each on a
laptop CPU; and `tests/e2e-whisper.mjs` plays a spoken "scroll down" into a fake microphone and checks that the page scrolls.

**Guided tour and spoken replies.** `describe this page` / `what's on this page` / `where am I` shows a card and reads aloud the
site, the title, the main headings, what you can do here (results to open, a search box, a message box, a form, a video) and the first
things to press. `stop reading` / `be quiet` stops it. `speak replies` makes VoiceNav say what the pill says (`stop talking back` to
end); the microphone is paused while it speaks so it never hears itself.

**Per-site packs.** `extension/sites.js` is data: for YouTube, Google Docs, Gmail and Amazon, "when you say X on this site, press the
element matching Y" ("the three dots" is the *video's* menu, "file" / "tools" / "gemini" in Docs, "compose" in Gmail, "cart" on
Amazon). A pack is tried only when the page's own labels matched nothing, adds a "what can I say" section for that site, and is
the one file to edit when a site changes (the log's "show failed commands" says which phrase missed).

## Results

Measured by `eval/run_eval.py` against `qwen2.5:3b` on a laptop CPU (Intel Core Ultra 5, no GPU).
Full output, including every miss, is in [`eval/results.md`](eval/results.md).

| Version | Commands | Accuracy | Median latency |
|---|---|---|---|
| v1: model returns a numeric id, LLM only | 50 dev | 64% | 1.4 s |
| v1: + resolver (hybrid) | 50 dev | 74% | 1.1 s |
| v2.1: label-constrained output + validation, LLM only | 50 dev | 78% | 1.6 s |
| **v2.1: hybrid (resolver + LLM)** | 50 dev | **92%** | 1.6 s |
| v2.1: LLM only, **held-out** commands | 28 held-out | **82%** | 1.0 s |
| v3.1 (after an independent review): LLM only | 50 dev | 82% | 1.1 s |
| **v3.1: hybrid (resolver + LLM)** | 50 dev | **94%** | 0.9 s |
| v3.1: hybrid, held-out | 28 held-out | 82% | 1.0 s |

How to read this honestly:

- The **dev set** (50) guided the design, so its numbers are optimistic. I first wrote prompt examples that overlapped with
  test commands, noticed, reworded them, and added the **held-out set** (28 commands written afterwards and never tuned on).
- The held-out set has no price or position commands, so the resolver doesn't fire there. 82% is the LLM alone.
  The resolver's contribution shows on the dev set (78% -> 92%) and in its unit tests.
- Both sets are small and use five mock page layouts (shop results, product, video, login, news), not live websites.
- Remaining misses are mostly semantic neighbours (e.g. "bookmark this" -> a different button), and commands like
  "enter my email" being treated as typing the words "my email" instead of focusing the field.

Other checks (2026-10-05, after the v0.3 work): 788 unit tests (parser, Hindi, help/undo, typing helpers, form and browse commands, site
packs, regressions from hands-on use); 52 backend tests; 33 detector checks; and browser tests loading the real extension into
Chromium: 157 (`e2e.mjs`), 41 (`e2e-chat.mjs`), 83 (`e2e-forms.mjs`), 66 (`e2e-browse.mjs`), 17 (`e2e-trusted.mjs`: the real-click
fallback, key presses, the tour) and 4 (`e2e-whisper.mjs`: a spoken phrase through a fake microphone and Whisper to a scroll).
`live-forms.mjs` was 27/27 on two public test forms on 2026-10-05 (before v0.3, not re-run).

**Top Indian sites** (`node tests/live-india.mjs`, see `eval/live-india-results.md`): 14 sites, **72 of 74 checks**. Per site: scroll
down / a little / up, "show numbers", "describe this page", and for shops and video "search for ..." then "open the second result".
Amazon 8/8, Flipkart 7/8, Myntra 7/8 (8/8 on three reruns), Wikipedia, Times of India, NDTV, IRCTC and Zomato all pass; Google,
YouTube, Instagram, WhatsApp, Facebook and IMDb were tested logged-out, where the page had nothing to scroll, so only the other checks
apply. Honest notes: it is a fresh logged-out browser, typed commands (no microphone), form submissions are blocked, nothing is
bought, sent or signed in, and no bot check was bypassed. A first run of this test, which also blocked pages' background requests,
made YouTube, Amazon and IMDb render blank: that was the test, not VoiceNav, and is how the test's safety rule was corrected.

## Tests

```
npm test                                              # 788 unit tests: parser, Hindi, forms, browse, site packs, regressions
npm run test:browser                                  # e2e + forms + chat + browse + trusted (real extension in Chromium)
npm run test:whisper                                  # spoken phrase -> fake microphone -> Whisper -> page scrolls (needs requirements-whisper.txt)
npm run test:backend                                  # backend: resolver, interpreter, API, offline speech endpoint
node tests/e2e-chat.mjs                               # chat mocks (no backend needed); BACKEND_PORT=... adds search-engine checks
node tests/live-india.mjs [site ...]                  # the top Indian sites, logged out (writes eval/live-india-results.md)
node tests/live-docs.mjs login | run "<doc url>"      # Google Docs on a real document, in a separate test profile you sign in to yourself
node tests/live.mjs youtube|amazon                    # real sites (see below)
node tests/live-matrix.mjs amazon|ddg|bing|google     # phrasing matrix on real sites
node tests/live-chat.mjs chatgpt|claude|gemini        # chat sites, logged out (ChatGPT: one harmless prompt)
npm install; npx playwright-core install chromium     # once
cd backend; .venv\Scripts\python ..\eval\run_eval.py --models qwen2.5:3b [--no-resolver] [--cases cases_heldout.json]
```

`live-docs.mjs` keeps its login in `tests/.profile-docs` (git-ignored): you sign in by hand to a throwaway Google account; no script ever
types a password. It types into a blank document, renames it and puts the name back, and reports what Google Docs looks like if a check fails.

The browser test uses Playwright's Chromium because branded Chrome 137+ ignores `--load-extension`. It enables a test-only
hook in a temporary copy of the extension; the shipped `content.js` has `TEST_HOOK = false`.

## Tested on real sites

`node tests/live.mjs youtube|amazon` drives the real extension on the real sites in a throwaway profile (no login; the only
state change is Add to Cart on a guest cart). Observed on 2026-10-04 on YouTube and amazon.in:

- **YouTube:** search; "open the first video" opened the page's actual first result; pause, play, mute, slow scroll, stop, go back.
- **Amazon India:** search; "open the second result" opened the page's actual second product (in a new tab, which it followed);
  Add to Cart worked on the real transparent button; when Amazon's warranty popup appeared, only its 6 controls were
  numbered (not the page behind it) and "click no thanks" dismissed it.
- **Phrasing matrix on amazon.in** (`node tests/live-matrix.mjs amazon`), typed commands against live pages, 2026-10-05:
  - natural phrasings at the top of a results page (position, name, price, "I just want to view...", "look at", "see more about"): **17 of 17**
    (the first version did 12 of 19; "view the second item" opened the first, and some phrasings clicked a price label);
  - scroll down, then "open the first/second one" acting on what is on screen: **5 of 5** (the first version: 0 of 5);
  - sidebar filters by name: 8 of 8; sort by price low to high / high to low / newest, which really re-sorts the page: 4 of 4;
  - other categories (running shoes, programming books), including the cheapest: 8 of 8;
  - clothing and hair products, 2026-10-05, on the final code (`AMAZON_QUERIES="..." node tests/live-matrix.mjs amazon D`):
    men's t-shirts 7/7, sarees 7/7, shampoo 7/7, hair oil 7/7, hair serum 6/6, women's kurtis / men's jeans / hair dryers 19/20
    (the one miss: the words "Amazon Brand" start several products, so it opened the first and said "Opened the first of 2 matches");
    sidebar filters (collar, sleeve, fit, "anti-hairfall", "growth", "ayurvedic") and Sort by on t-shirts and hair oil: 24/24;
  - bugs these found: price comparisons only saw the nearest 50 results; a sponsored Prime Video film ("Shampoo") counted as
    the cheapest product; and a silent pick among several matching products now says "Opened the first of N matches".
- **An independent review (a stronger model reading the diff) found 9 more problems, all fixed and covered by tests:** negation
  ("I don't want to add it") and product names ("laptop bag") counted as permission to press Add to cart; grocery sites'
  bare "ADD" button wasn't recognised; position words inside names ("first aid kit", "4th of July sale") were treated as
  positions; "click art" pressed "Add to cart"; "stop listening" in one tab didn't reach other tabs; "second cheapest" opened
  the cheapest; and every server error was reported as "offline". My own fix for the position-word problem was then too strict
  and cost 6 of 17 real-Amazon phrasings until I loosened it, which is why the real-site matrix is re-run after every change.
- **Google could not be tested live.** It served the automated browser a reCAPTCHA, which I did not try to get around.
  The "People also ask" questions are covered by a local page that imitates them, not by the real Google page.
- Bugs this found and fixed: result counting by link instead of by card; ads and unrelated links counted as results;
  cards below the fold not counted; a 3 s delay computing prices on huge pages; silently picking one of many identical
  "Add to cart" buttons instead of asking; voice turning off in new tabs.
- Amazon changes layout and A/B tests (the popup appears on some runs and not others), so results vary run to run.
  Those runs used typed commands via a test hook, not a microphone, so speech recognition accuracy is not covered.

### Chat sites, search engines, and a re-run (2026-10-05)

Which results come from where matters, so each is labelled **REAL** (the live site), **STAND-IN** (a real site used in place
of one that can't be tested) or **MOCK** (a local page that copies a site's mechanics).

| Site | Kind | Suite | Result |
|---|---|---|---|
| YouTube | REAL | `live.mjs youtube`: search, open first video, pause, play, mute, slow scroll, stop, go back, `type` + `press enter` | 9 of 9 |
| amazon.in | REAL | `live.mjs amazon`: search, open second result (new tab), Add to Cart, `type` + `submit` | 4 of 4 |
| amazon.in | REAL | `live-matrix.mjs amazon`: phrasings 17/17, scrolled 6/6, filters 8/8, sort 4/4, other categories 8/8 | 43 of 43 (scrolled group on a re-run: the first run's one miss was a bug in the test, which wanted the 3rd result on screen when only 2 fit) |
| DuckDuckGo | REAL, STAND-IN for Google | `live-matrix.mjs ddg`: search from the home page, first/second/third result by position, by name | 7 of 7 (after a fix, below) |
| Bing | REAL, STAND-IN for Google | `live-matrix.mjs bing` | search 1 of 1; then Bing showed a "solve the challenge" bot check, so I stopped |
| chatgpt.com, logged out | REAL | `live-chat.mjs chatgpt`: `type What is 2 plus 2?`, then `send` | Sent: the message appeared 0.57 s after "send". ChatGPT's reply was empty (its side), and I sent only that one prompt |
| claude.ai, gemini.google.com | REAL | `live-chat.mjs claude|gemini`: load only | Both need a login (Claude also showed a Cloudflare check). **Not tested live** |
| Claude / ChatGPT / Gemini composers | MOCK | `e2e-chat.mjs` | see below |

- **Google** still serves a reCAPTCHA, so it isn't tested. "People also ask" questions are covered only by a mock: neither Bing
  (3 queries, 2 markets) nor DuckDuckGo showed expandable questions to the test browser.
- **The chat bug ("it typed the message but didn't send it, or took long"):** reproduced on the mocks first (2 of 31 checks passed).
  There was no "send" command, so "send" went to the AI. That took 1-5 s, and the model pressed **New chat**, **Sign up** or
  Gemini's **Microphone**. `submit` / `press enter` sent a synthetic Enter, which chat editors ignore, and still said "Submitted".
  `type` with nothing focused wrote into Claude's sidebar search instead of the message box.
  `press enter` was parsed as "click something called enter".
  Now: local send commands; a Send-button finder that searches outwards from the message box and stays inside its form;
  a bounded wait for the button to enable; Enter only as a last resort, reported as sent only if the box actually emptied;
  and a backend guard that won't answer a "send" request with a voice, new-chat, sign-up or upload button.
- **Mock chat pages** (`tests/fixtures/`): `claude.html` (ProseMirror, "Send message" disabled for 600 ms after typing,
  synthetic Enter ignored, a search box in the sidebar), `chatgpt.html` (#prompt-textarea; send-button appears only with text,
  next to voice and dictate buttons), `gemini.html` (Quill editor watched by a MutationObserver; send button appears after
  typing, next to a microphone), `chat-search.html` (a search box *and* a chat box), `chat-plain.html` (no Send button;
  an order form's "Submit order" must still ask for a yes), `engine.html` (Bing/DuckDuckGo result markup with sitelinks).
  Command-to-sent time on the mocks: median about 0.6 s (mostly the Claude mock's deliberate 600 ms), max about 0.65 s.
- **Search engines:** "click the second result" on real Bing opened the *first* result, and on DuckDuckGo it clicked a
  "More results from python.org" sitelink: those sites had no result adapter, so it guessed. Both now have one
  (DuckDuckGo: 7 of 7 live; Bing is covered only by the mock after its bot check).
- The real logged-out ChatGPT composer is now a plain `<textarea>` with a submit-type "Send message" button, not the
  ProseMirror editor in the mock. The mock still covers the logged-in ProseMirror version, but I haven't been able to check
  that against the real site.

## New websites: learning the layout

Most commands name things ("click add to cart", "open Sony headphones") and work on any site through the page's accessible
names. Only position and price words ("the second result", "the cheapest") need to know what counts as a result. Hand-written
rules exist for Amazon, YouTube, Google, Bing and DuckDuckGo; for every other site `extension/detector.js` works it out:

1. **Look for repeated blocks.** A results list is many similar sibling blocks that each hold one main link. Candidates are
   scored on how many there are, how long the titles are, whether the links are distinct, whether the blocks are similar in
   size, and whether they hold pictures or prices. Menus and footers are ruled out; sidebars are discounted. Grids built from
   rows ("three cards per row") are merged.
2. **Save it as a rule.** The layout becomes a few CSS selectors (card, main link, price), keyed by site and page type, kept in
   `chrome.storage.local`, one entry per site and page shape (about 200 bytes each; at most 300 entries, least recently used dropped; a blog
   with a different path for every article uses one entry per article, so the limit matters there). Selectors only, never code.
   Generated class names (`css-1x9fj`) are ignored, so a rule survives a site redeploying.
3. **Re-check it on every visit.** The key is the site plus the shape of the page (first path segment and how deep the path is), so a
   rule learned on a listing is not applied to a detail page. A saved rule is used only if it still finds at least 3 results and about as
   many as when it was learned (within 30%); otherwise it is dropped and the page is analysed again. A rule is only saved when its
   selector matches exactly the blocks it was made from. A rule that matches the wrong blocks but in a similar number could still
   survive until the layout changes.

It runs entirely in your browser on the page you are viewing; nothing is downloaded or sent anywhere.

**Measured** (`node tests/detector.test.mjs`, `node tests/live-detect.mjs dev|A|B`; the live runs are read-only, in a throwaway
browser, no logins; "right" means precision and recall both at least 0.8 **and** the first three results in the right order):

| Set | What | Result |
|---|---|---|
| Synthetic pages | 14 awkward layouts: generated class names, tables, menus and footers, a trending sidebar, cards with several links, variant lists, no classes at all, and a page with no results | 29/29 checks |
| Dev sites (used while tuning) | amazon.in, YouTube, DuckDuckGo | 3/3 |
| Pool A (first seen blind, then tuned on) | books.toscrape.com (2 pages), webscraper.io test shop, Hacker News, Wikipedia search | first blind run 4/5; 5/5 after fixing the miss (shops that lay products out in rows of three, with short names) |
| Pool B (never looked at before the final run) | Open Library, Project Gutenberg, Lobsters, GitHub Trending | **4/4**. Disclosures: the first Gutenberg query returned only 2 books, so I re-ran it with another query; PyPI showed a bot check and was replaced by dev.to, whose layout didn't match my answer key, so neither could be judged |

Speed: 3 to 40 ms per page. Honest caveats: five or six unseen sites is a small sample; Gutenberg's first query returned only 2
books (fewer than the 3 needed to call something a list) so I re-ran it with a query that returns many; a page with fewer than
3 results isn't treated as a list; canvas-drawn apps and icon-only buttons have no structure to detect. The live test only measures pages that DO have a list of
results; on an ordinary article page a "related stories" block can be mistaken for results, so "open the second result" there would open
one of those (that case is not measured).

## Known limits

- Chrome's speech service needs internet. `use offline speech` runs Whisper on this computer instead (see above); it was tested with a
  recording of a synthetic voice, not a person talking, and costs about 1.8 s per phrase on a laptop CPU.
- Real clicks go through Chrome's debugger, so Chrome shows its "debugging this browser" bar for an instant. It is Chromium-only.
- Docs typing and the share links were written from how Google Docs and YouTube are built and are checked by mock pages only; the real
  Docs test (`live-docs.mjs`) needs a login you provide.
- No vision model for icon-only buttons with no name at all (it needs a large model and screenshots); they are found by their hidden
  names and synonyms, as before.
- Price extraction reads text near each link, so "cheapest" works on sites that show prices there and may not on others.
- Voice itself isn't covered by automated tests (no microphone in a test browser), so auto-resume after reload and
  pausing in hidden tabs were checked by reading the code, not by running them.
- A first real-world test on Amazon found two bugs (transparent "Add to Cart" buttons were skipped, and spoken
  numbers like "four" were heard as "for"); both are fixed and covered by tests. Expect more on other sites.
- Layouts, iframes and closed shadow roots will cause misses.
- Chat sending was verified on mocks and on logged-out ChatGPT only, not on the real Claude or Gemini (they need a login).
  If an editor updates its state slowly *and* its Send button was already enabled for earlier text, a very quick
  "type" + "send" could send the old text. The extension waits 120 ms in that case, but can't detect it in general.
- English and Hindi/Hinglish only (see "Hindi and Hinglish"); Hindi was tested with typed text, not real speech.
- Evaluation is one model on one machine. Browser support: Chrome and Edge (Chromium). Brave blocks Chrome's speech service (use offline
  speech); Firefox lacks the speech API and the extension format; Safari would need a rewrite.

## Layout

```
extension/   manifest.json, parser.js (commands), content.js (page scan, actions, UI), sites.js (per-site packs), forms.js, detector.js,
             background.js (backend bridge, tabs, real clicks and keys, log)
backend/     app/ (schemas, resolver, llm, interpreter, transcribe, main), tests/
eval/        cases.json (dev), cases_heldout.json, run_eval.py, results.md, live-india-results.md
tests/       *.test.js (unit), e2e*.mjs (real extension in Chromium), live*.mjs (real sites), audio/ (spoken test phrases), fixtures/
```
