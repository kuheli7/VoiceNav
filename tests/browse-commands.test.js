// Tabs, other sites, video controls, a named part of the page, search, deselect, the log, and several commands in one sentence
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, toEnglish, siteFor, splitChain } = require("../extension/parser.js");
const say = (s) => parse(toEnglish(s));

const CASES = [
  // log
  ["show the log", { type: "log", view: "all" }], ["open the log", { type: "log", view: "all" }], ["show failed commands", { type: "log", view: "failed" }],
  ["what failed", { type: "log", view: "failed" }], ["clear the log", { type: "logClear" }],
  // tabs
  ["open a new tab", { type: "tab", op: "new" }], ["new tab", { type: "tab", op: "new" }], ["next tab", { type: "tab", op: "next" }],
  ["switch to the previous tab", { type: "tab", op: "prev" }], ["switch to the second tab", { type: "tab", op: "index", n: 2 }],
  ["go to tab 3", { type: "tab", op: "index", n: 3 }], ["switch to the last tab", { type: "tab", op: "index", n: -1 }],
  ["list tabs", { type: "tab", op: "list" }], ["what tabs are open", { type: "tab", op: "list" }], ["close this tab", { type: "tab", op: "close" }],
  ["reopen closed tab", { type: "tab", op: "reopen" }], ["bring back the last closed tab", { type: "tab", op: "reopen" }],
  // sites
  ["open youtube", { type: "openSite", name: "youtube", url: "https://www.youtube.com/", newTab: false }],
  ["go to gmail", { type: "openSite", name: "gmail", url: "https://mail.google.com/", newTab: false }],
  ["open amazon in a new tab", { type: "openSite", name: "amazon", url: "https://www.amazon.in/", newTab: true }],
  ["take me to the github website", { type: "openSite", name: "github", url: "https://github.com/", newTab: false }],
  ["open example.com", { type: "openSite", name: "example.com", url: "https://example.com/", newTab: false }],
  ["open chat gpt", { type: "openSite", name: "chatgpt", url: "https://chatgpt.com/", newTab: false }],
  ["switch to gmail", { type: "tab", op: "site", name: "gmail", url: "https://mail.google.com/" }],
  ["switch to the youtube tab", { type: "tab", op: "site", name: "youtube", url: "https://www.youtube.com/" }],
  // video
  ["speed 1.5", { type: "mediaSpeed", rate: 1.5 }], ["set speed to 2x", { type: "mediaSpeed", rate: 2 }], ["playback speed 0.75", { type: "mediaSpeed", rate: 0.75 }],
  ["1.25x", { type: "mediaSpeed", rate: 1.25 }], ["double speed", { type: "mediaSpeed", rate: 2 }], ["normal speed", { type: "mediaSpeed", rate: 1 }],
  ["make the video faster", { type: "mediaSpeed", delta: 1 }], ["slow down the video", { type: "mediaSpeed", delta: -1 }],
  ["skip 10 seconds", { type: "mediaSeek", by: 10 }], ["rewind 30 seconds", { type: "mediaSeek", by: -30 }], ["go back 10 seconds", { type: "mediaSeek", by: -10 }],
  ["forward two minutes", { type: "mediaSeek", by: 120 }], ["go to 2 minutes", { type: "mediaSeek", to: 120 }], ["restart", { type: "mediaSeek", to: 0 }],
  ["fullscreen", { type: "mediaExtra", kind: "fullscreen" }], ["exit full screen", { type: "mediaExtra", kind: "exitFullscreen" }],
  ["theater mode", { type: "mediaExtra", kind: "theater" }], ["turn on captions", { type: "mediaExtra", kind: "captions", on: true }],
  ["subtitles off", { type: "mediaExtra", kind: "captions", on: false }], ["open the mini player", { type: "mediaExtra", kind: "expandMini" }],
  ["open the video in the corner", { type: "mediaExtra", kind: "expandMini" }], ["expand the video", { type: "mediaExtra", kind: "expandMini" }],
  ["close the miniplayer", { type: "mediaExtra", kind: "closeMini" }], ["next video", { type: "mediaExtra", kind: "next" }],
  ["skip ad", { type: "mediaExtra", kind: "skipAd" }], ["like", { type: "mediaExtra", kind: "like" }], ["like the video", { type: "mediaExtra", kind: "like" }],
  ["thumbs up", { type: "mediaExtra", kind: "like" }], ["dislike", { type: "mediaExtra", kind: "dislike" }], ["subscribe", { type: "mediaExtra", kind: "subscribe" }],
  // a named part of the page
  ["scroll down the recent chats", { type: "scroll", dir: "down", amount: 0.8, area: "left" }], ["scroll up in the sidebar", { type: "scroll", dir: "up", amount: 0.8, area: "left" }],
  ["scroll the left side down", { type: "scroll", dir: "down", amount: 0.8, area: "left" }], ["scroll up the main chat", { type: "scroll", dir: "up", amount: 0.8, area: "main" }],
  ["scroll down the right side", { type: "scroll", dir: "down", amount: 0.8, area: "right" }],
  // search, selecting, backing out
  ["search", { type: "focusSearch" }], ["click search", { type: "focusSearch" }], ["search chats", { type: "focusSearch" }],
  ["deselect all", { type: "uncheckAll" }], ["unselect all emails", { type: "uncheckAll" }], ["clear selection", { type: "uncheckAll" }],
  ["select all emails", { type: "selectAllItems" }], ["close the email", { type: "close", back: true }], ["back to inbox", { type: "close", back: true }],
];
for (const [said, want] of CASES) test(`"${said}"`, () => { const { said: _s, ...got } = say(said) || {}; assert.deepEqual(say(said) ? got : null, want); });

// Ordinary speech keeps its meaning
const UNCHANGED = [
  ["scroll down", "scroll"], ["go back", "nav"], ["close", "close"], ["pause", "media"], ["undo", "undo"], ["search for shoes", "search"],
  ["open the second result", null], ["faster", "scrollSpeed"], ["click the plus icon", "clickText"], ["open the cheapest one", null],
];
for (const [said, type] of UNCHANGED) test(`unchanged: "${said}"`, () => assert.equal(say(said)?.type ?? null, type));

test("only known sites and addresses are taken for a site", () => {
  assert.equal(siteFor("youtube").name, "youtube");
  assert.equal(siteFor("you tube").name, "youtube");
  assert.equal(siteFor("example dot com").url, "https://example.com/");
  for (const s of ["the second result", "my cart", "index.html", "the project", "", "page", "something.unknownext"]) assert.equal(siteFor(s), null, s);
});

test("a decimal speed keeps its decimal point, and an absurd one is refused", () => {
  assert.equal(say("speed 1.5").rate, 1.5);
  assert.notEqual(say("speed 20")?.type, "mediaSpeed");
});

// chains
test("several commands in one sentence", () => {
  assert.deepEqual(splitChain("open the project and then chat"), ["open the project", "chat"]);
  assert.deepEqual(splitChain("scroll down then click the first result then go back"), ["scroll down", "click the first result", "go back"]);
  assert.deepEqual(splitChain("go to the top, then scroll down"), ["go to the top", "scroll down"]);
});
test("text that contains 'then' is never split", () => {
  assert.equal(splitChain("type first this then that"), null);
  assert.equal(splitChain("send what is 2 plus 2 and then 3"), null);
  assert.equal(splitChain("search for salt then pepper"), null);
  assert.equal(splitChain("fill name with Asha then Rao"), null);
  assert.equal(splitChain("scroll down"), null);
  assert.equal(splitChain("then scroll"), null);
  assert.equal(splitChain("so then what"), null); // the first part is not a command
});
test("after a text command, the rest stays together", () => {
  assert.deepEqual(splitChain("go to the top then type hello then world"), ["go to the top", "type hello then world"]);
});
test("nothing here throws on odd input", () => {
  for (const s of ["", "then", "and then", "open", "switch to", "speed", "skip seconds", "scroll the", "close the", "go to"]) assert.doesNotThrow(() => { say(s); splitChain(s); });
});

// found by the independent review: everyday phrases these rules must not take
test("review: phrases that must keep their old meaning", () => {
  assert.notEqual(say("go to inbox")?.type, "close");
  assert.notEqual(say("go to messages")?.type, "close");
  assert.notEqual(say("clear all")?.type, "uncheckAll");
  assert.notEqual(say("clear everything")?.type, "uncheckAll");
  assert.notEqual(say("last video")?.kind, "previous");
  assert.notEqual(say("close the post")?.type, "close");
  assert.equal(say("open docs").said, "docs");
  assert.equal(say("open the calendar").said, "calendar");
  assert.equal(say("deselect all")?.type, "uncheckAll");
  assert.equal(say("clear selection")?.type, "uncheckAll");
  assert.equal(say("close the email")?.type, "close");
});

test("mishearings: 'skip add' is 'skip ad', and 'switch tab' means the next tab", () => {
  for (const s of ["skip add", "skip the add", "skip ads", "skip", "skip it"]) assert.deepEqual(say(s), { type: "mediaExtra", kind: "skipAd" }, s);
  for (const s of ["switch tab", "switch tabs", "change tab", "switch the tab", "switch to other tab", "tab switch"]) assert.deepEqual(say(s), { type: "tab", op: "next" }, s);
  assert.notEqual(say("skip to the end")?.kind, "skipAd");
});
