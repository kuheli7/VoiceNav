// Regressions from hands-on use (YouTube, Google Docs): small scrolls, tab phrasing, "pause" mishearings, comments
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, toEnglish } = require("../extension/parser.js");
const say = (s) => parse(toEnglish(s));

const CASES = [
  ["scroll down a little", { type: "scroll", dir: "down", amount: 0.3 }],
  ["scroll up a little", { type: "scroll", dir: "up", amount: 0.3 }],
  ["scroll down just a little", { type: "scroll", dir: "down", amount: 0.3 }],
  ["scroll down a little bit", { type: "scroll", dir: "down", amount: 0.3 }],
  ["scroll down", { type: "scroll", dir: "down", amount: 0.8 }],
  ["go back to the previous tab", { type: "tab", op: "prev" }],
  ["go back to the first tab", { type: "tab", op: "index", n: 1 }],
  ["can you go to the first tab that is open", { type: "tab", op: "index", n: 1 }],
  ["switch to the 2nd tab", { type: "tab", op: "index", n: 2 }],
  ["last tab", { type: "tab", op: "index", n: -1 }],
  ["paws", { type: "media", kind: "pause" }],
  ["pause it", { type: "media", kind: "pause" }],
  ["wait", { type: "media", kind: "pause" }],
  ["pause scrolling", { type: "stopScroll" }],
  ["comment on the video", { type: "comment" }],
  ["add a comment", { type: "comment" }],
  ["write a comment", { type: "comment" }],
];
for (const [said, want] of CASES) test(`"${said}"`, () => assert.deepEqual(say(said), want));

test("typing the word comment is still typing", () => assert.equal(say("type comment")?.type, "type"));

for (const [said, v, h] of [["move the voice icon to the top right", "top", "right"], ["move to the top left", "top", "left"], ["move it to the bottom left corner", "bottom", "left"], ["put the mic at the top right", "top", "right"]])
  test(`"${said}" moves the panel`, () => assert.deepEqual(say(said), { type: "movePanel", v, h }));

test("Docs: rename, and typing into a named place", () => {
  assert.deepEqual(say("rename the document to My Notes"), { type: "rename", text: "My Notes" });
  assert.deepEqual(say("rename this file to Trip plan"), { type: "rename", text: "Trip plan" });
  assert.equal(say("type hello in the document").target, "document");
  assert.equal(say("type Trip plan in the title").target, "title");
  assert.equal(say("type hello in gemini").target, "gemini");
  assert.equal(say("type hi in the box").type, "fillOrType"); // other boxes still go through the normal form logic
});

test("speech alternatives: the first guess that is a command wins", () => {
  const { bestAlternative } = require("../extension/parser.js");
  assert.equal(bestAlternative(["scroll dawn", "scroll down", "scroll town"]), "scroll down");
  assert.equal(bestAlternative(["move the pores", "pause"]), "pause");
  assert.equal(bestAlternative(["scroll down", "scroll dawn"]), "scroll down");           // the top guess already works
  assert.equal(bestAlternative(["tell me a story", "tell me a stony"]), "tell me a story"); // nothing parses: keep the top guess
  assert.equal(bestAlternative([]), "");
});

test("real clicks can be switched by voice", () => {
  assert.deepEqual(say("use real clicks"), { type: "trusted", on: true });
  assert.deepEqual(say("stop using real clicks"), { type: "trusted", on: false });
});

test("guided tour and spoken replies", () => {
  for (const s of ["what's on this page", "describe this page", "read the page", "give me a tour", "where am I"]) assert.deepEqual(say(s), { type: "tour" }, s);
  assert.equal(say("what's on the screen").type, "readResults"); // the results list is unchanged
  for (const s of ["stop reading", "be quiet", "stop talking"]) assert.deepEqual(say(s), { type: "hush" }, s);
  assert.deepEqual(say("speak replies"), { type: "talkBack", on: true });
  assert.deepEqual(say("stop talking back"), { type: "talkBack", on: false });
});
