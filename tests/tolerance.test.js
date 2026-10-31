// Feedback from a first outside tester: word order ("scroll a little up"), the move-the-pill phrase without "move", and a single
// misspelled or misheard letter must not break a command. Typo repair must never turn guessed words into a click or a search.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, toEnglish } = require("../extension/parser.js");
const say = (s) => parse(toEnglish(s));

const CASES = [
  ["scroll a little up", { type: "scroll", dir: "up", amount: 0.3 }],
  ["scroll a little down", { type: "scroll", dir: "down", amount: 0.3 }],
  ["scroll a bit up", { type: "scroll", dir: "up", amount: 0.3 }],
  ["scroll slightly down", { type: "scroll", dir: "down", amount: 0.3 }],
  ["scroll a lot down", { type: "scroll", dir: "down", amount: 1.5 }],
  ["voice icon to the top left", { type: "movePanel", v: "top", h: "left" }],
  ["the mic bottom right", { type: "movePanel", v: "bottom", h: "right" }],
  ["top right", { type: "movePanel", v: "top", h: "right" }],
  ["bottom left corner", { type: "movePanel", v: "bottom", h: "left" }],
  ["take the voice icon to the bottom right", { type: "movePanel", v: "bottom", h: "right" }],
  ["scrol dwn", { type: "scroll", dir: "down", amount: 0.8 }],
  ["scroll dwon a litle", { type: "scroll", dir: "down", amount: 0.3 }],
  ["nxt tab", { type: "tab", op: "next" }],
  ["pausse", { type: "media", kind: "pause" }],
  ["unmte", { type: "media", kind: "unmute" }],
  ["mvoe the voice icon to the top left", { type: "movePanel", v: "top", h: "left" }],
];
for (const [said, want] of CASES) test(`"${said}"`, () => assert.deepEqual(say(said), want));

// Words that are not misspelled commands stay untouched: no repair, and nothing that acts on guessed words
test("typo repair never produces a click, search or typed text", () => {
  for (const s of ["clik buy now", "serch for shoes", "typ hello", "find me cheap headphones", "tap", "tab"]) {
    const r = say(s);
    assert.ok(r === null || !["clickText", "search", "type", "clickNumber"].includes(r.type) || /^(?:tab)$/.test(s), `${s} -> ${JSON.stringify(r)}`);
  }
  assert.equal(say("find me cheap headphones"), null);
});
