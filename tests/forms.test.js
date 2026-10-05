// Spoken text -> typed text: punctuation, capitals, spacing, digits, emails, dates. English and Hindi/Hinglish.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../extension/forms.js");

// ------------------------------------------------------------------ dictation
const DICTATION = [
  // [spoken, text already in the box, expected]
  ["hello comma how are you question mark", "", "Hello, how are you?"],
  ["i am fine period", "", "I am fine."],
  ["i'm fine and i'll come", "", "I'm fine and I'll come"],
  ["thank you", "", "Thank you"],
  ["thank you full stop", "", "Thank you."],
  ["wow exclamation mark", "", "Wow!"],
  ["wow exclamation point", "", "Wow!"],
  ["what is this question mark it is odd full stop", "", "What is this? It is odd."],
  ["first colon apples semicolon pears", "", "First: apples; pears"],
  ["wait dot dot dot what", "", "Wait... What"],
  ["dear sir comma new paragraph thank you for your reply full stop", "", "Dear sir,\n\nThank you for your reply."],
  ["line one new line line two", "", "Line one\nLine two"],
  ["he said open quote hello close quote loudly", "", 'He said "hello" loudly'],
  ["well hyphen known", "", "Well-known"],
  ["open bracket see below close bracket full stop", "", "(See below)."],
  // "period" is an ordinary word unless it ends what was said
  ["the time period was long", "", "The time period was long"],
  ["the period of time period", "", "The period of time."],
  ["it is over period", "", "It is over."],
  ["end period full stop", "", "End.."],
  // joining onto what is already there
  ["and then i left", "Hello there.", " And then I left"],
  ["nice", "Hello there", " nice"],
  ["nice", "Hello there ", "nice"],
  ["nice", "Hello\n", "Nice"],
  ["nice", "Hello.\n\n", "Nice"],
  ["more", "", "More"],
  ["world", "hello", " world"],
  ["comma next", "hello", ", next"],
  ["full stop", "hello", "."],
  ["next", "(", "next"],
  ["go", 'He said "', "go"],
  ["he left", 'He said "hi" ', "he left"],
  ["he left", 'He said "hi"', " he left"],
  // Hindi and Hinglish
  ["फिर मैं घर गया पूर्ण विराम", "", "फिर मैं घर गया."],
  ["नमस्ते कॉमा आप कैसे हैं प्रश्न चिह्न", "", "नमस्ते, आप कैसे हैं?"],
  ["ghar gaya purn viram", "", "Ghar gaya."],
  ["pehli line nayi line doosri line", "", "Pehli line\nDoosri line"],
  // degenerate input
  ["", "", ""],
  ["   ", "", ""],
  ["comma", "", ","],
  ["new line", "", "\n"],
  ["new paragraph", "abc", "\n\n"],
];
for (const [said, before, want] of DICTATION) {
  test(`dictation: "${said}" after ${JSON.stringify(before)}`, () => assert.equal(F.formatDictation(said, before), want));
}

test("dictation never throws and keeps its shape on random word soup", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const vocab = ["hello", "comma", "period", "full", "stop", "new", "line", "paragraph", "open", "close", "quote", "bracket", "i", "i'm", "question",
    "mark", "exclamation", "point", "hyphen", "colon", "semicolon", "नमस्ते", "पूर्ण", "विराम", "the", "a", "x", "ellipsis", "dot", "unquote"];
  const befores = ["", "Hello", "Hello.", "Hello\n", 'He said "', "(", "word ", "a-"];
  for (let n = 0; n < 4000; n++) {
    const words = Array.from({ length: 1 + Math.floor(rnd() * 9) }, () => vocab[Math.floor(rnd() * vocab.length)]);
    const before = befores[Math.floor(rnd() * befores.length)];
    const out = F.formatDictation(words.join(" "), before);
    assert.equal(typeof out, "string");
    assert.ok(!/ {2,}/.test(out), `double space in ${JSON.stringify(out)} from ${words.join(" ")}`);
    assert.ok(!/ \n|\n /.test(out), `space next to a newline in ${JSON.stringify(out)}`);
    assert.ok(!/ [,.;:?!]/.test(out), `space before punctuation in ${JSON.stringify(out)} from ${words.join(" ")}`);
    if (before === "") assert.ok(!/^ /.test(out), `leading space with an empty box: ${JSON.stringify(out)}`);
    assert.ok(!/ $/.test(out), `trailing space: ${JSON.stringify(out)}`);
  }
});

// ------------------------------------------------------------------ digits
const DIGITS = [
  ["nine eight seven six five four three two one zero", "9876543210"],
  ["nine eight double seven six", "98776"],
  ["triple nine", "999"],
  ["double two double three", "2233"],
  ["plus nine one nine eight seven six five four three two one zero", "+919876543210"],
  ["98765 43210", "9876543210"],
  ["9 8 7 6", "9876"],
  ["oh one two", "012"],
  ["ek do teen char paanch", "12345"],
  ["शून्य एक दो तीन", "0123"],
  ["९८७६", "9876"],
  ["nine and eight then seven", "987"],
  ["1-800-555", "1800555"],
  ["one two three four", "1234"],
  ["five five five dash one two", "55512"],
  ["डबल नौ आठ", "998"],
  // not numbers: say so instead of typing something wrong
  ["", null], ["hello", null], ["nine eight hello", null], ["call me", null], ["plus", null], ["dash dash", null],
];
for (const [said, want] of DIGITS) test(`digits: "${said}"`, () => assert.equal(F.spokenDigits(said), want));

// ------------------------------------------------------------------ email
const EMAILS = [
  ["asha dot sharma at gmail dot com", "asha.sharma@gmail.com"],
  ["asha at gmail dot com", "asha@gmail.com"],
  ["rohit nine nine at the rate yahoo dot co dot in", "rohit99@yahoo.co.in"],
  ["priya underscore k at outlook dot com", "priya_k@outlook.com"],
  ["a dash b at c dot org", "a-b@c.org"],
  ["john plus work at example dot com", "john+work@example.com"],
  ["Asha Sharma At Gmail Dot Com", "asha@gmail.com".replace("asha", "ashasharma")],
  ["asha एट द रेट gmail डॉट com", "asha@gmail.com"],
  ["asha at gmail dot com.", "asha@gmail.com"],
  // not an email
  ["not an email", null], ["", null], ["asha at", null], ["at gmail dot com", null], ["asha at gmail", null], ["a at b at c dot com", null],
];
for (const [said, want] of EMAILS) test(`email: "${said}"`, () => assert.equal(F.spokenEmail(said), want));

// ------------------------------------------------------------------ dates
const DATES = [
  ["5th of March 1999", "1999-03-05"], ["march 5 1999", "1999-03-05"], ["5 march 1999", "1999-03-05"], ["March 5th, 1999", "1999-03-05"],
  ["1 jan 2000", "2000-01-01"], ["31 december 2024", "2024-12-31"], ["29 february 2024", "2024-02-29"], ["1999-3-5", "1999-03-05"], ["2001-12-31", "2001-12-31"],
  ["29 february 2023", null], ["31 april 2000", null], ["32 march 2000", null], ["0 march 2000", null], ["foo 5 1999", null], ["5 march", null], ["", null],
  ["5 march 99", null],
];
for (const [said, want] of DATES) test(`date: "${said}"`, () => assert.equal(F.parseSpokenDate(said), want));

// ------------------------------------------------------------------ editing
const WORD_CASES = [["hello world", "hello"], ["hello world ", "hello"], ["hello", ""], ["", ""], ["  ", ""], ["One. Two three.", "One. Two"], ["a\nb c", "a\nb"], ["a b\n", "a"]];
for (const [before, want] of WORD_CASES) test(`delete last word: ${JSON.stringify(before)}`, () => assert.equal(F.deleteLastWord(before), want));
const SENT_CASES = [["One. Two three.", "One."], ["One. Two three", "One."], ["One! Two? Three", "One! Two?"], ["Only one.", ""], ["", ""], ["x", ""], ["A. B. C.", "A. B."]];
for (const [before, want] of SENT_CASES) test(`delete last sentence: ${JSON.stringify(before)}`, () => assert.equal(F.deleteLastSentence(before), want));
test("editing helpers survive non-strings", () => {
  assert.equal(F.deleteLastWord(null), "");
  assert.equal(F.deleteLastSentence(undefined), "");
});

test("a review's findings in forms.js", () => {
  assert.equal(F.spokenDigits("twenty five"), "25");
  assert.equal(F.spokenDigits("thirteen"), "13");
  assert.equal(F.spokenDigits("nine double"), null);
  assert.equal(F.deleteLastSentence("Pi is 3.14"), "");
  assert.equal(F.deleteLastSentence("Hello there. Pi is 3.14"), "Hello there.");
  assert.equal(F.parseSpokenDate("the 5th of march 1999"), "1999-03-05");
  assert.equal(F.parseSpokenDate("05/03/1999"), "1999-03-05");
  assert.equal(F.parseSpokenDate("31/02/1999"), null);
  assert.equal(F.formatDictation("an exclamation of joy", ""), "An exclamation of joy");
  assert.equal(F.formatDictation("wow exclamation mark", ""), "Wow!");
});
