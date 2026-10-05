// Hindi and Hinglish: toEnglish() turns what was said (Devanagari or romanized) into the English command parse() knows.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse, toEnglish, stripWake, toNumber } = require("../extension/parser.js");

// [said, the English it becomes]. Commands that need the page (position, price) parse to null and go to the backend,
// which is why the English text itself is checked: it is what the AI receives.
const cases = [
  // scrolling, romanized
  ["neeche scroll karo", "scroll down"],
  ["niche scroll karo", "scroll down"],
  ["scroll neeche karo", "scroll down"],
  ["scroll down karo", "scroll down"],
  ["neeche karo", "scroll down"],
  ["neeche jao", "scroll down"],
  ["neeche", "scroll down"],
  ["upar", "scroll up"],
  ["upar scroll kariye", "scroll up"],
  ["thoda upar", "scroll up a bit"],
  ["thoda neeche scroll karo", "scroll down a bit"],
  ["bahut neeche scroll karo", "scroll down a lot"],
  ["aur neeche", "scroll down"],
  ["zara neeche", "scroll down"],
  ["kya aap neeche scroll kar sakte hain", "scroll down"],
  ["neeche scroll karna hai", "scroll down"],
  ["dheere dheere neeche scroll karo", "scroll down slowly"],
  ["dhire dhire upar scroll karo", "scroll up slowly"],
  ["scroll down slowly karo", "scroll down slowly"],
  ["tez neeche scroll karo", "scroll down fast"],
  ["neeche scroll karte raho", "keep scrolling down"],
  ["scroll karte raho", "keep scrolling down"],
  ["scroll karo", "scroll down"],
  ["scroll band karo", "stop scrolling"],
  ["scroll roko", "stop scrolling"],
  ["dheere", "slowly"],
  ["dheere se", "slowly"],
  ["aur dheere", "slower"],
  ["dheere karo", "slower"],
  ["tez karo", "faster"],
  ["aur tez", "faster"],
  ["sabse neeche jao", "go to the bottom"],
  ["sabse niche", "go to the bottom"],
  ["end pe jao", "go to the bottom"],
  ["neeche tak jao", "go to the bottom"],
  ["sabse upar jao", "go to the top"],
  ["shuru mein jao", "go to the top"],
  ["top pe jao", "go to the top"],
  // scrolling, Devanagari (what the hi-IN recognizer writes)
  ["नीचे स्क्रॉल करो", "scroll down"],
  ["स्क्रॉल डाउन करो", "scroll down"],
  ["स्क्रोल अप करो", "scroll up"],
  ["ऊपर जाओ", "scroll up"],
  ["थोड़ा नीचे", "scroll down a bit"],
  ["धीरे धीरे नीचे स्क्रॉल करो", "scroll down slowly"],
  ["तेज़ नीचे स्क्रॉल करो", "scroll down fast"],
  ["सबसे ऊपर जाओ", "go to the top"],
  ["सबसे नीचे जाओ", "go to the bottom"],
  // stop
  ["ruko", "stop"],
  ["ruk jao", "stop"],
  ["roko", "stop"],
  ["bas", "stop"],
  ["ruko ruko", "stop"],
  ["ek minute ruko", "stop"],
  ["रुको", "stop"],
  ["रुक जाओ", "stop"],
  ["रुकिए", "stop"],
  ["ruko mat", "keep going"],
  // navigation
  ["peeche jao", "go back"],
  ["piche jao", "go back"],
  ["wapas jao", "go back"],
  ["peeche", "go back"],
  ["back jao", "go back"],
  ["pichle page pe jao", "go back"],
  ["aage jao", "go forward"],
  ["aage badho", "go forward"],
  ["agle page pe jao", "click next"],
  ["पीछे जाओ", "go back"],
  ["वापस जाओ", "go back"],
  ["आगे जाओ", "go forward"],
  ["अगला पेज", "click next"],
  ["page refresh karo", "refresh the page"],
  ["page dobara load karo", "refresh the page"],
  ["पेज रिफ्रेश करो", "refresh the page"],
  // opening by position or price (resolved by the backend)
  ["doosra result kholo", "open the second result"],
  ["dusra result kholiye", "open the second result"],
  ["pehla result kholo", "open the first result"],
  ["pahla wala kholo", "open the first one"],
  ["teesra video kholo", "open the third video"],
  ["tisra video chalao", "open the third video"],
  ["chautha product kholo", "open the fourth product"],
  ["paanchva result open karo", "open the fifth result"],
  ["panchwa wala kholo", "open the fifth one"],
  ["aakhri video kholo", "open the last video"],
  ["akhiri wala kholo", "open the last one"],
  ["doosre wale pe click karo", "click the second one"],
  ["second wala result kholo", "open the second result"],
  ["kholo teesra result", "open the third result"],
  ["open doosra result", "open the second result"],
  ["open karo second result", "open the second result"],
  ["click karo doosre wale pe", "click the second one"],
  ["mujhe doosra result dekhna hai", "view the second result"],
  ["doosra result kholna chahta hoon", "open the second result"],
  ["mujhe teesra result dikhao", "show me the third result"],
  ["doosra sawaal kholo", "open the second question"],
  ["sabse sasta wala open karo", "open the cheapest one"],
  ["sabse sastha wala kholo", "open the cheapest one"],
  ["sasta wala kholo", "open the cheapest one"],
  ["sabse mehnga wala kholo", "open the most expensive one"],
  ["sabse mehenga wala kholo", "open the most expensive one"],
  ["sabse mahanga product dikhao", "show me the most expensive product"],
  ["doosra sabse sasta kholo", "open the second cheapest"],
  ["mujhe sabse sasta wala chahiye", "open the cheapest one"],
  ["doosra wala", "open the second one"],
  ["aakhri wala", "open the last one"],
  ["पहला रिजल्ट खोलो", "open the first result"],
  ["दूसरा रिजल्ट खोलो", "open the second result"],
  ["तीसरा वीडियो खोलो", "open the third video"],
  ["चौथा वाला खोलो", "open the fourth one"],
  ["पांचवां रिजल्ट खोलो", "open the fifth result"],
  ["आखिरी वाला खोलो", "open the last one"],
  ["सबसे सस्ता वाला खोलो", "open the cheapest one"],
  ["सबसे महंगा वाला खोलो", "open the most expensive one"],
  ["दूसरा सबसे सस्ता खोलो", "open the second cheapest"],
  ["दूसरा सवाल खोलो", "open the second question"],
  ["मुझे दूसरा रिजल्ट दिखाओ", "show me the second result"],
  // by name
  ["Sony wala kholo", "open sony one"],
  ["sign in pe click karo", "click sign in"],
  ["help pe click karo", "click help"],
  ["free delivery select karo", "select free delivery"],
  ["4 star chuno", "select 4 star"],
  ["साइन इन पर क्लिक करो", "click sign in"],
  ["हेल्प पर क्लिक करो", "click help"],
  ["सोनी हेडफोन खोलो", "open soni headphone"], // unknown Devanagari is spelt out in Latin letters for the AI
  // numbers overlay
  ["number dikhao", "show numbers"],
  ["numbers dikhao", "show numbers"],
  ["iska number dikhao", "show numbers"],
  ["sab number dikhao", "show numbers"],
  ["number chhupao", "hide numbers"],
  ["number hatao", "hide numbers"],
  ["number band karo", "hide numbers"],
  ["नंबर दिखाओ", "show numbers"],
  ["नंबर हटाओ", "hide numbers"],
  ["teen number pe click karo", "click 3"],
  ["number teen pe click karo", "click 3"],
  ["paanch number dabao", "click 5"],
  ["3 pe click karo", "click 3"],
  ["das dabao", "click 10"],
  ["gyarah number kholo", "click 11"],
  ["chaudah number dabao", "click 14"],
  ["do number dabao", "click 2"],
  ["number paanch", "click 5"],
  ["पांच नंबर पर क्लिक करो", "click 5"],
  ["नंबर पांच दबाओ", "click 5"],
  ["तीन दबाओ", "click 3"],
  ["बारह खोलो", "click 12"],
  ["5 नंबर पर क्लिक करो", "click 5"],
  ["५ नंबर दबाओ", "click 5"],
  // search and typing: the words are kept as said
  ["headphone search karo", "search for headphone"],
  ["search karo headphones", "search for headphones"],
  ["wireless headphones dhundo", "search for wireless headphones"],
  ["laal joote khojo", "search for laal joote"],
  ["headphone ko search karo", "search for headphone"],
  ["सर्च करो हेडफोन", "search for हेडफोन"],
  ["हेडफोन सर्च करो", "search for हेडफोन"],
  ["हेडफोन खोजो", "search for हेडफोन"],
  ["जूते ढूंढो", "search for जूते"],
  ["hello world likho", "type hello world"],
  ["likho namaste", "type namaste"],
  ["type karo good morning", "type good morning"],
  ["Good Morning type karo", "type Good Morning"],
  ["नमस्ते लिखो", "type नमस्ते"],
  ["हेलो टाइप करो", "type हेलो"],
  ["text saaf karo", "clear the text"],
  ["text mitao", "clear the text"],
  // sending and asking (chat sites)
  ["bhejo", "send"],
  ["bhej do", "send"],
  ["send karo", "send"],
  ["message bhejo", "send"],
  ["isko bhej do", "send"],
  ["send button dabao", "press send"],
  ["hello bhejo", "send hello"],
  ["namaste likh ke bhejo", "type namaste and send it"],
  ["likho hello aur bhej do", "type hello and send it"],
  ["Claude se puchho 2 plus 2 kitna hai", "ask 2 plus 2 kitna hai"],
  ["भेजो", "send"],
  ["भेज दो", "send"],
  ["सेंड करो", "send"],
  ["मैसेज भेजो", "send"],
  ["नमस्ते लिख के भेजो", "type नमस्ते and send it"],
  ["enter dabao", "press enter"],
  ["submit karo", "submit"],
  // media
  ["video roko", "pause the video"],
  ["video pause karo", "pause the video"],
  ["pause karo", "pause"],
  ["video chalao", "play the video"],
  ["chalao", "play"],
  ["play karo", "play"],
  ["awaaz band karo", "mute"],
  ["mute karo", "mute"],
  ["awaaz chalu karo", "unmute"],
  ["वीडियो रोको", "pause the video"],
  ["वीडियो चलाओ", "play the video"],
  ["आवाज़ बंद करो", "mute"],
  ["म्यूट करो", "mute"],
  ["आवाज़ चालू करो", "unmute"],
  // popups and "band karo"
  ["popup band karo", "close"],
  ["popup hatao", "close"],
  ["ye window band karo", "close"],
  ["close karo", "close"],
  ["escape dabao", "press escape"],
  ["band karo", "stop or close"],
  ["isko band karo", "stop or close"],
  ["पॉपअप बंद करो", "close"],
  ["पॉप अप बंद करो", "close"],
  ["क्लोज करो", "close"],
  ["बंद करो", "stop or close"],
  ["इसे बंद करो", "stop or close"],
  // shopping
  ["add to cart karo", "add to cart"],
  ["add karo", "add to cart"],
  ["isko cart mein add karo", "add to cart"],
  ["cart me daal do", "add to cart"],
  ["basket mein rakho", "add to cart"],
  ["abhi kharido", "click buy now"],
  ["price low to high sort karo", "sort by price low to high"],
  ["sasta pehle sort karo", "sort by price low to high"],
  ["ऐड टू कार्ट करो", "add to cart"],
  ["कार्ट में डालो", "add to cart"],
  ["इसे कार्ट में डालो", "add to cart"],
  ["ऐड टू कार्ट पर क्लिक करो", "add to cart"],
  // yes / no
  ["haan", "yes"],
  ["ha", "yes"],
  ["haan ji", "yes"],
  ["ji haan", "yes"],
  ["ji", "yes"],
  ["theek hai", "yes"],
  ["thik hai", "yes"],
  ["bilkul", "yes"],
  ["haan kar do", "yes"],
  ["हाँ", "yes"],
  ["हां", "yes"],
  ["ठीक है", "yes"],
  ["जी हाँ", "yes"],
  ["nahi", "cancel"],
  ["nahin", "cancel"],
  ["na", "cancel"],
  ["mat karo", "cancel"],
  ["rehne do", "cancel"],
  ["cancel karo", "cancel"],
  ["nahi chahiye", "cancel"],
  ["add mat karo", "cancel"],
  ["नहीं", "cancel"],
  ["मत करो", "cancel"],
  ["रहने दो", "cancel"],
  // sleep, wake word, mic, panel
  ["so jao", "go to sleep"],
  ["jag jao", "wake up"],
  ["jaago", "wake up"],
  ["utho", "wake up"],
  ["सो जाओ", "go to sleep"],
  ["जागो", "wake up"],
  ["hamesha suno", "always listen"],
  ["wake word chalu karo", "use wake word"],
  ["wake word band karo", "always listen"],
  ["sunna band karo", "stop listening"],
  ["mic band karo", "stop listening"],
  ["panel chhupao", "hide panel"],
  ["panel dikhao", "show panel"],
  ["panel upar le jao", "move panel to the top"],
  ["panel ko baayen le jao", "move panel to the left"],
  // switching the recognizer's language, including what an English recognizer may hear
  ["hindi mein bolo", "speak hindi"],
  ["hindi bolo", "speak hindi"],
  ["Hindi main bolo", "speak hindi"],
  ["Hindi may bolo", "speak hindi"],
  ["Hindi me bolo", "speak hindi"],
  ["Indy mein bolo", "speak hindi"],
  ["hindi mein baat karo", "speak hindi"],
  ["english mein bolo", "speak english"],
  ["English me bolo", "speak english"],
  ["angrezi mein bolo", "speak english"],
  ["angreji me bolo", "speak english"],
  ["हिंदी में बोलो", "speak hindi"],
  ["इंग्लिश में बोलो", "speak english"],
  ["अंग्रेजी में बोलो", "speak english"],
  ["स्पीक इंग्लिश", "speak english"],
  ["स्विच टू इंग्लिश", "speak english"],
];

for (const [said, english] of cases) {
  test(`"${said}" -> "${english}"`, () => assert.equal(toEnglish(said), english));
}

// What parse() then does with a few of them
const parsed = [
  ["neeche scroll karo", { type: "scroll", dir: "down", amount: 0.8 }],
  ["धीरे धीरे नीचे स्क्रॉल करो", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["ruko", { type: "media", kind: "pause" }], // a bare stop ends a voice scroll first (content.js)
  ["peeche jao", { type: "nav", to: "back" }],
  ["iska number dikhao", { type: "numbers", on: true }],
  ["5 नंबर पर क्लिक करो", { type: "clickNumber", n: 5 }],
  ["सर्च करो हेडफोन", { type: "search", text: "हेडफोन" }],
  ["Good Morning type karo", { type: "type", text: "Good Morning" }],
  ["भेजो", { type: "send" }],
  ["namaste likh ke bhejo", { type: "send", text: "namaste" }],
  ["add to cart karo", { type: "clickText", text: "add to cart" }],
  ["Sony wala kholo", { type: "clickText", text: "sony", navigate: true }],
  ["band karo", { type: "halt" }],
  ["popup band karo", { type: "close" }],
  ["हाँ", { type: "confirm", yes: true }],
  ["mat karo", { type: "confirm", yes: false }],
  ["hindi mein bolo", { type: "lang", lang: "hi-IN" }],
  ["अंग्रेजी में बोलो", { type: "lang", lang: "en-IN" }],
  ["so jao", { type: "snooze" }],
  ["wake word chalu karo", { type: "attention", on: true }],
];
for (const [said, cmd] of parsed) {
  test(`parse(toEnglish("${said}"))`, () => assert.deepEqual(parse(toEnglish(said)), cmd));
}

test("position and price commands still go to the backend, in English", () => {
  for (const s of ["doosra result kholo", "sabse sasta wala open karo", "तीसरा वीडियो खोलो", "aakhri wala kholo", "doosra wala"]) {
    assert.equal(parse(toEnglish(s)), null, s);
    assert.match(toEnglish(s), /^(?:open|click|view|show me) the /, s);
  }
});

test("language switching works in English too", () => {
  for (const [s, lang] of [["speak hindi", "hi-IN"], ["switch to Hindi", "hi-IN"], ["hindi mode", "hi-IN"], ["use hindi", "hi-IN"],
    ["speak english", "en-IN"], ["change language to English", "en-IN"], ["english language", "en-IN"]]) {
    assert.deepEqual(parse(toEnglish(s)), { type: "lang", lang }, s);
  }
  // naming a language on its own (a page's language menu) is not a switch
  assert.deepEqual(parse(toEnglish("click english")), { type: "clickText", text: "english" });
  assert.equal(parse(toEnglish("Hindi")), null);
});

// Conversation must never become a command: it comes back unchanged (and parses to nothing)
test("ordinary Hindi and Hinglish conversation is not a command", () => {
  for (const s of [
    "main ghar ja raha hoon", "tum kahan ho", "aaj mausam bahut accha hai", "mujhe bhook lagi hai", "kya tumne khana khaya",
    "woh peeche baitha hai", "upar wale kamre mein hai", "neeche aa jao beta", "maine kal ek phone kharida", "kal milte hain",
    "kya haal hai", "mera number kya hai", "do din baad aana", "mummy ko phone karo", "khana kha lo", "chai bana do",
    "yeh bahut mehnga hai", "sabse sasta kaun sa hai", "upar se neeche tak", "dheere bolo", "aage kya hua", "aur batao",
    "haan main aa raha hoon", "nahi yaar mujhe nahi pata", "mummy ko bhejo", "wo kitne ka hai", "theek hai main dekhta hoon",
    "मैं घर जा रहा हूँ", "तुम कहाँ हो", "आज मौसम अच्छा है", "मुझे भूख लगी है", "वो पीछे बैठा है", "कल मिलते हैं",
    "क्या हाल है", "मेरा नंबर क्या है", "ऊपर वाले कमरे में है", "नीचे आ जाओ", "मैंने कल एक फोन खरीदा", "यह बहुत महंगा है",
    "सबसे सस्ता कौन सा है", "पीछे मत देखो यार क्या हुआ",
  ]) {
    assert.equal(toEnglish(s), s, s);
    assert.equal(parse(toEnglish(s)), null, s);
  }
});

// English that merely contains Hindi-looking words: unchanged
test("English commands with Hindi-looking words are left alone", () => {
  for (const s of [
    "open Karo Tea", "search for Karo tea", "do it", "click do", "click ek", "open the main menu", "open age of empires",
    "search for kal ho naa ho", "play Tum Hi Ho", "search for upar wala song", "type mujhe khana chahiye", "search for sabse sasta phone",
    "send kal milte hain", "open the band page", "search for niche perfumes", "click on the men section", "open Zara",
    "ask Claude what is 2 plus 2", "sort by price low to high",
  ]) assert.equal(toEnglish(s), s, s);
  assert.deepEqual(parse(toEnglish("open Karo Tea")), { type: "clickText", text: "karo tea", navigate: true });
  assert.deepEqual(parse(toEnglish("do it")), { type: "confirm", yes: true });
  assert.deepEqual(parse(toEnglish("search for sabse sasta phone")), { type: "search", text: "sabse sasta phone" });
});

// Every phrase in the English test file must pass through toEnglish untouched
test("every English parser test phrase is unchanged by toEnglish", () => {
  const src = fs.readFileSync(path.join(__dirname, "parser.test.js"), "utf8");
  const phrases = [...src.matchAll(/^\s*\[\s*"((?:[^"\\]|\\.)*)"\s*,/gm)].map((m) => JSON.parse(`"${m[1]}"`));
  assert.ok(phrases.length > 100, `only found ${phrases.length}`);
  for (const p of phrases) assert.equal(toEnglish(p), p, p);
});

test("wake words in Devanagari", () => {
  assert.equal(stripWake("नोवा नीचे स्क्रॉल करो"), "नीचे स्क्रॉल करो");
  assert.equal(stripWake("नोवा, पीछे जाओ"), "पीछे जाओ");
  assert.equal(stripWake("कंप्यूटर रुको"), "रुको");
  assert.equal(stripWake("हे नोवा"), "");
  assert.equal(stripWake("Nova neeche scroll karo"), "neeche scroll karo");
  assert.equal(stripWake("नोवाक जोकोविच"), null); // not the wake word, just starts like it
  assert.equal(stripWake("novartis is a company"), null);
});

test("Hindi number words", () => {
  for (const [w, n] of [["ek", 1], ["paanch", 5], ["पांच", 5], ["पाँच", 5], ["das", 10], ["पंद्रह", 15], ["bees", 20], ["pachas", 50]]) {
    assert.equal(toNumber(w), n, w);
  }
  assert.equal(toNumber("do"), null); // English "do"
  assert.deepEqual(parse("click paanch"), { type: "clickNumber", n: 5 });
});

test("non-text input is returned as is", () => {
  assert.equal(toEnglish(""), "");
  assert.equal(toEnglish("   "), "   ");
  assert.equal(toEnglish(undefined), undefined);
});
