// Help, undo and "read the results": English and Hindi/Hinglish, plus ordinary speech that must not trigger them.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, toEnglish } = require("../extension/parser.js");

const type = (said) => parse(toEnglish(said))?.type ?? null;

const SHOULD = {
  help: ["what can I say", "What can you do?", "help", "Help me", "show me the commands", "list the commands", "what are the commands",
    "what commands do you have", "commands", "madad", "help karo", "kya bol sakta hoon", "मदद", "क्या बोल सकता हूँ", "commands dikhao"],
  hideCard: ["close help", "hide the help", "dismiss the commands", "hide help", "help band karo"],
  undo: ["undo", "Undo that", "undo this", "undo it", "undo the last thing", "take that back", "take it back", "revert that", "reverse that",
    "undo my last action", "undo karo", "अनडू करो", "wapas karo", "वापस करो", "undo kar do", "ise undo karo"],
  readResults: ["read the results", "read me the results", "read out the results", "list the products", "tell me the options", "what is on the screen",
    "read the screen", "results padho", "स्क्रीन पर क्या है", "screen par kya hai"],
};

for (const [expected, phrases] of Object.entries(SHOULD)) {
  for (const said of phrases) test(`"${said}" is ${expected}`, () => assert.equal(type(said), expected));
}

// ordinary sentences and neighbours that look similar must stay what they were
const SHOULD_NOT = [
  "helpful tips for beginners", "help me find a laptop", "I need help with my order", "undo the knot in my hair", "undone",
  "what is on sale", "what is on my mind", "read the results of the match", "read more", "list your products here",
  "show help desk", "commands and conquer", "close", "go back", "peeche jao", "cancel", "stop",
  // a site's own Help link must stay reachable
  "open help", "show help", "click help",
];
for (const said of SHOULD_NOT) {
  test(`"${said}" is not help, undo or read`, () => assert.ok(!["help", "hideCard", "undo", "readResults"].includes(type(said)), `${said} -> ${type(said)}`));
}

test("ordinary commands are unchanged", () => {
  assert.equal(type("go back"), "nav");
  assert.equal(type("peeche jao"), "nav");
  assert.equal(type("close"), "close");
  assert.equal(type("cancel"), "confirm");
  assert.equal(type("open the second result"), null); // the backend resolves positions
  assert.equal(type("scroll down"), "scroll");
});
