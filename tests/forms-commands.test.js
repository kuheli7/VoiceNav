// The spoken commands for dictation, editing a box and forms, and what must NOT be taken for one
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, toEnglish } = require("../extension/parser.js");
const say = (s) => parse(toEnglish(s));
// "heard" (what was said, for the AI fallback) and "soft" (no such field: let the AI try) are checked on their own below
const core = (s) => { const c = say(s); if (!c) return c; const { heard, soft, hint, full, said, ...rest } = c; return rest; };

const CASES = [
  ["start dictation", { type: "dictate", on: true }], ["dictation mode", { type: "dictate", on: true }], ["stop dictation", { type: "dictate", on: false }],
  ["turn off dictation", { type: "dictate", on: false }], ["end dictation mode", { type: "dictate", on: false }],
  ["next field", { type: "nextField", dir: 1 }], ["go to the next box", { type: "nextField", dir: 1 }], ["press tab", { type: "nextField", dir: 1 }],
  ["previous field", { type: "nextField", dir: -1 }], ["go to previous input", { type: "nextField", dir: -1 }], ["shift tab", { type: "nextField", dir: -1 }],
  ["list fields", { type: "listFields" }], ["what fields are there", { type: "listFields" }], ["read the form", { type: "listFields" }],
  ["what did I type", { type: "readField" }], ["read this field", { type: "readField" }],
  ["repeat", { type: "repeat" }], ["do that again", { type: "repeat" }],
  ["delete last word", { type: "edit", op: "deleteWord" }], ["delete the last sentence", { type: "edit", op: "deleteSentence" }],
  ["delete that", { type: "edit", op: "deleteThat" }], ["scratch that", { type: "edit", op: "deleteThat" }], ["backspace", { type: "edit", op: "backspace" }],
  ["select all", { type: "edit", op: "selectAll" }], ["new line", { type: "edit", op: "newLine" }], ["new paragraph", { type: "edit", op: "newParagraph" }],
  ["fill name with Asha Sharma", { type: "fill", field: "name", value: "Asha Sharma" }],
  ["set the city to Pune", { type: "fill", field: "city", value: "Pune" }],
  ["change my email to a@b.com", { type: "fill", field: "email", value: "a@b.com" }],
  ["fill in the last name as Rao.", { type: "fill", field: "last name", value: "Rao" }],
  ["clear the name field", { type: "fill", field: "name", value: "" }], ["clear email", { type: "fill", field: "email", value: "" }],
  ["tick the terms checkbox", { type: "check", field: "terms", on: true }], ["untick newsletter", { type: "check", field: "newsletter", on: false }],
  ["uncheck the gift wrap box", { type: "check", field: "gift wrap", on: false }], ["turn on the dark mode switch", { type: "check", field: "dark mode", on: true }],
  ["type email asha at gmail dot com", { type: "typeEmail", text: "asha at gmail dot com" }],
  ["enter my phone number nine eight seven six", { type: "typeNumber", text: "nine eight seven six" }],
  ["type the date 5th of March 1999", { type: "typeDate", text: "5th of March 1999" }],
  // Hindi / Hinglish
  ["dictation shuru karo", { type: "dictate", on: true }], ["डिक्टेशन बंद करो", { type: "dictate", on: false }],
  ["agla field", { type: "nextField", dir: 1 }], ["pichla field", { type: "nextField", dir: -1 }], ["fields dikhao", { type: "listFields" }],
  ["phir se", { type: "repeat" }], ["last word hatao", { type: "edit", op: "deleteWord" }], ["text saaf karo", { type: "clear" }],
];
for (const [said, want] of CASES) test(`"${said}"`, () => assert.deepEqual(core(said), want));

test('"type Asha in name" can be either a field or plain text, so the page decides', () => {
  const c = say("type Asha in name");
  assert.equal(c.type, "fillOrType"); assert.equal(c.value, "Asha"); assert.equal(c.field, "name"); assert.equal(c.text, "Asha in name"); assert.equal(c.strict, false);
});
test('"put X in Y" never falls back to typing the sentence', () => assert.equal(say("put 5 in quantity").strict, true));

// Ordinary speech that merely contains these words keeps its old meaning
const UNCHANGED = [
  ["type hello world", { type: "type", text: "hello world" }],
  ["clear the text", { type: "clear" }], ["clear the box", { type: "clear" }], ["clear the field", { type: "clear" }],
  ["check the box", null], ["check out", null], ["clear the cart", null], ["clear search", null], ["press tab", { type: "nextField", dir: 1 }],
  ["search for shoes in blue", { type: "search", text: "shoes in blue" }],
  ["undo", { type: "undo" }], ["send", { type: "send" }],
];
for (const [said, want] of UNCHANGED) test(`unchanged: "${said}"`, () => {
  const got = say(said);
  if (want === null) assert.equal(got, null); else assert.equal(got?.type, want.type);
});

test("nothing here throws on odd input", () => {
  for (const s of ["", " ", "fill", "fill with", "tick", "untick", "set to", "type in", "type email", "clear ", "put in into", "next", "delete", "list", "start"]) assert.doesNotThrow(() => say(s));
});

test("fill with 'fill' is a form command; set/change/clear are soft, so everyday speech can reach the AI", () => {
  assert.equal(say("fill name with Asha").soft, false);
  assert.equal(say("set the volume to 50").soft, true);
  assert.equal(say("clear notifications").soft, true);
  assert.equal(say("set the volume to 50").heard, "set the volume to 50");
  assert.equal(say("put this in my cart for later").strict, true);
  assert.equal(say("put this in my cart for later").heard, "put this in my cart for later");
});

test('"tick the default checkbox" remembers you said checkbox', () => {
  assert.equal(say("tick the default checkbox").hint, "checkbox");
  assert.equal(say("tick default").hint, "");
});

test("phrases from a review that must not be taken for form commands", () => {
  assert.notEqual(say("next question")?.type, "nextField");
  assert.notEqual(say("check out the gift box")?.type, "check");
  assert.notEqual(say("agla kholo")?.type, "nextField");
  assert.notEqual(say("kya likha hai")?.type, "readField");
  assert.equal(say("write email to my boss asking for leave").full, "email to my boss asking for leave"); // so the page can type it as text
});
