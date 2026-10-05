const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, toNumber } = require("../extension/parser.js");

const cases = [
  ["scroll down", { type: "scroll", dir: "down", amount: 0.8 }],
  ["Scroll up.", { type: "scroll", dir: "up", amount: 0.8 }],
  ["please page down", { type: "scroll", dir: "down", amount: 0.8 }],
  ["scroll down a bit", { type: "scroll", dir: "down", amount: 0.3 }],
  ["scroll up a little bit", { type: "scroll", dir: "up", amount: 0.3 }],
  ["scroll down a lot", { type: "scroll", dir: "down", amount: 1.5 }],
  ["go to the top", { type: "scrollEdge", to: "top" }],
  ["scroll to bottom", { type: "scrollEdge", to: "bottom" }],
  ["go back", { type: "nav", to: "back" }],
  ["forward", { type: "nav", to: "forward" }],
  ["refresh the page", { type: "nav", to: "reload" }],
  ["refresh page", { type: "nav", to: "reload" }],
  ["pause", { type: "media", kind: "pause" }],
  ["pause the video", { type: "media", kind: "pause" }],
  ["resume", { type: "media", kind: "play" }],
  ["mute", { type: "media", kind: "mute" }],
  ["show numbers", { type: "numbers", on: true }],
  ["hide the numbers", { type: "numbers", on: false }],
  ["click 14", { type: "clickNumber", n: 14 }],
  ["click number fourteen", { type: "clickNumber", n: 14 }],
  ["open twenty one", { type: "clickNumber", n: 21 }],
  ["click on the sign in button", { type: "clickText", text: "sign in" }],
  ["add to cart", { type: "clickText", text: "add to cart" }],
  ["add it to my basket", { type: "clickText", text: "add to cart" }],
  ["search for wireless headphones", { type: "search", text: "wireless headphones" }],
  ["look for red shoes", { type: "search", text: "red shoes" }],
  ["type Hello World", { type: "type", text: "Hello World" }],
  ["clear the text", { type: "clear" }],
  ["submit", { type: "submit" }],
  ["yes", { type: "confirm", yes: true }],
  ["cancel", { type: "confirm", yes: false }],
  ["stop listening", { type: "off" }],
  ["go to sleep", { type: "snooze" }],
  ["wake up", { type: "wakeUp" }],
  ["use wake word", { type: "attention", on: true }],
  ["always listen", { type: "attention", on: false }],
  ["previous page", { type: "nav", to: "back" }],
  ["close", { type: "close" }],
  ["close this popup", { type: "close" }],
  ["dismiss the dialog", { type: "close" }],
  ["press escape", { type: "close" }],
  ["escape", { type: "close" }],
  ["click close", { type: "clickText", text: "close" }], // naming a button still clicks it
  // continuous scrolling
  ["scroll down slowly", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["scroll up fast", { type: "autoScroll", dir: "up", speed: "fast" }],
  ["go down gently", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["keep scrolling", { type: "autoScroll", dir: "down", speed: "medium" }],
  ["start scrolling up slowly", { type: "autoScroll", dir: "up", speed: "slow" }],
  ["stop scrolling", { type: "stopScroll" }],
  ["faster", { type: "scrollSpeed", faster: true }],
  ["slow down", { type: "scrollSpeed", faster: false }],
  // more ways to ask for a continuous scroll, and the second half of speech that was split in two
  ["scroll slowly", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["scroll down very slowly", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["slowly scroll down", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["go slowly up", { type: "autoScroll", dir: "up", speed: "slow" }],
  ["can you please scroll down slowly", { type: "autoScroll", dir: "down", speed: "slow" }],
  ["slowly", { type: "scrollMore", speed: "slow" }],
  ["very slowly", { type: "scrollMore", speed: "slow" }],
  ["fast", { type: "scrollMore", speed: "fast" }],
  ["keep going", { type: "scrollMore", speed: null }],
  ["continue scrolling", { type: "scrollMore", speed: null }],
  // moving the pill out of the way
  ["move panel to the top left", { type: "movePanel", v: "top", h: "left" }],
  ["move the pill right", { type: "movePanel", v: null, h: "right" }],
  ["move the panel up", { type: "movePanel", v: "top", h: null }],
  ["put the controls bottom left", { type: "movePanel", v: "bottom", h: "left" }],
  ["hide the panel", { type: "panel", show: false }],
  ["show panel", { type: "panel", show: true }],
  // "open ... page" follows links; filler words are dropped from the label
  ["open the fresh mini orange page", { type: "clickText", text: "fresh mini orange", navigate: true }],
  ["open sony headphones", { type: "clickText", text: "sony headphones", navigate: true }],
  ["go to the technology section", { type: "clickText", text: "technology section", navigate: true }],
  ["click the sign in button", { type: "clickText", text: "sign in" }],
  // conversational phrasing: filler is dropped, "view"/"see"/"look at" follow links
  ["I just want to view the Sony headphones", { type: "clickText", text: "sony headphones", navigate: true }],
  ["I'd like to see the sony headphones", { type: "clickText", text: "sony headphones", navigate: true }],
  ["can you please open the sign in page", { type: "clickText", text: "sign in", navigate: true }],
  ["let me look at the deals", { type: "clickText", text: "deals", navigate: true }],
  ["I want to scroll down", { type: "scroll", dir: "down", amount: 0.8 }],
  ["could you go back", { type: "nav", to: "back" }],
  ["I want to select free delivery", { type: "clickText", text: "free delivery" }],
  ["see more about JBL Tune 520BT", { type: "clickText", text: "jbl tune 520bt", navigate: true }],
  ["view the pTron Studio Pro one", { type: "clickText", text: "ptron studio pro", navigate: true }],
  // a position word inside a name is part of the name
  ["open the first aid kit", { type: "clickText", text: "first aid kit", navigate: true }],
  ["view the 4th of July sale", { type: "clickText", text: "4th of july sale", navigate: true }],
  ["open the second water filter", { type: "clickText", text: "second water filter", navigate: true }],
  ["see the last airbender", { type: "clickText", text: "last airbender", navigate: true }],
  ["open the best of lofi mix", { type: "clickText", text: "best of lofi mix", navigate: true }],
  ["open the sony ones", { type: "clickText", text: "sony", navigate: true }],
  // sorting
  ["sort by price low to high", { type: "sortBy", text: "price low to high" }],
  ["sort the results by newest", { type: "sortBy", text: "newest" }],
  ["I want to sort by featured", { type: "sortBy", text: "featured" }],
  ["sort by", { type: "clickText", text: "sort by" }],
  // mishearings
  ["click for", { type: "clickNumber", n: 4 }],
  ["click number to", { type: "clickNumber", n: 2 }],
  ["open ate", { type: "clickNumber", n: 8 }],
  ["add to card", { type: "clickText", text: "add to cart" }],
  ["ad to cart", { type: "clickText", text: "add to cart" }],
  // chat sites: sending is local and instant, never a guess by the AI
  ["send", { type: "send" }],
  ["send it", { type: "send" }],
  ["Send message.", { type: "send" }],
  ["send the message now", { type: "send" }],
  ["press send", { type: "send" }],
  ["click the send button", { type: "send" }],
  ["hit send", { type: "send" }],
  ["submit message", { type: "send" }],
  ["submit the prompt", { type: "send" }],
  ["can you please send it", { type: "send" }],
  ["okay send it", { type: "send" }],
  ["submit", { type: "submit" }], // plain "submit" keeps its meaning (forms, search boxes)
  ["press enter", { type: "submit" }],
  ["type What is 2 plus 2? and send it", { type: "send", text: "What is 2 plus 2?" }],
  ["type hello there, then send", { type: "send", text: "hello there" }],
  ["write explain gravity and then press enter", { type: "send", text: "explain gravity" }],
  ["send what is 3 plus 3", { type: "send", text: "what is 3 plus 3" }],
  ["send a message saying I'll be late.", { type: "send", text: "I'll be late" }],
  ["ask what is the capital of France?", { type: "send", text: "what is the capital of France?" }],
  ["Ask Claude to write a haiku about rain", { type: "send", text: "write a haiku about rain" }],
  ["ask ChatGPT, what is 2 plus 2", { type: "send", text: "what is 2 plus 2" }],
  ["please ask Gemini what is 4 plus 4", { type: "send", text: "what is 4 plus 4" }],
  ["type send me the report", { type: "type", text: "send me the report" }], // "send" inside typed text is just text
  ["search for how to send money", { type: "search", text: "how to send money" }],
];

for (const [input, expected] of cases) {
  test(`"${input}"`, () => assert.deepEqual(parse(input), expected));
}

test("position and price commands are left for the backend", () => {
  for (const s of [
    "open the second result", "click the cheapest one", "select the last one",
    "open the 3rd video", "click the most expensive", "choose the best one",
    // the same, said the way people actually talk
    "view the second item", "I just want to view the second item", "I want to see the third product",
    "look at the fourth one", "see more about the second one", "I'd like to see the cheapest item",
    "click the second question", "expand the third question", "can you open the first one please",
    "open the second cheapest one", "view the cheapest headphones", "open the last one on screen", "click the best one",
  ]) assert.equal(parse(s), null, s);
});

test("unknown speech returns null", () => {
  for (const s of ["", "   ", "what is the weather", "make me a sandwich", "send it to mom"]) assert.equal(parse(s), null, s);
});

test("wake word is stripped only when said first", () => {
  const { stripWake } = require("../extension/parser.js");
  assert.equal(stripWake("Nova scroll down"), "scroll down");
  assert.equal(stripWake("hey nova, click five"), "click five");
  assert.equal(stripWake("computer search for shoes"), "search for shoes");
  assert.equal(stripWake("voice nav go back"), "go back");
  assert.equal(stripWake("Nova"), "");
  assert.equal(stripWake("scroll down"), null);
  assert.equal(stripWake("I told my computer science teacher"), null); // not at the start
  assert.equal(stripWake("novartis is a company"), null); // word boundary
});

test("number words", () => {
  assert.equal(toNumber("seven"), 7);
  assert.equal(toNumber("forty-two"), 42);
  assert.equal(toNumber("ninety nine"), 99);
  assert.equal(toNumber("banana"), null);
});
