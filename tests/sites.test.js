// Per-site command packs: which phrase maps to which selector on which site
const test = require("node:test");
const assert = require("node:assert/strict");
const { aliasFor, packFor, PACKS } = require("../extension/sites.js");

test("YouTube: the video's own three dots, share, settings", () => {
  assert.match(aliasFor("www.youtube.com", "three dots").selector, /ytd-watch-metadata/);
  assert.equal(aliasFor("www.youtube.com", "the three dots").label, "More actions");
  assert.equal(aliasFor("www.youtube.com", "share").label, "Share");
  assert.equal(aliasFor("www.youtube.com", "captions").label, "Captions");
});
test("Docs: menus, Gemini and the title", () => {
  for (const [said, label] of [["file", "File menu"], ["the tools menu", "Tools menu"], ["gemini", "Gemini"], ["ask gemini", "Gemini"], ["document title", "Document title"]])
    assert.equal(aliasFor("docs.google.com", said)?.label, label, said);
});
test("Gmail and Amazon", () => {
  assert.equal(aliasFor("mail.google.com", "compose").label, "Compose");
  assert.equal(aliasFor("www.amazon.in", "my cart").label, "Cart");
  assert.equal(aliasFor("www.amazon.in", "cart").label, "Cart");
});
test("a pack applies only on its own site, and unknown phrases match nothing", () => {
  assert.equal(aliasFor("example.com", "three dots"), null);
  assert.equal(aliasFor("www.youtube.com", "compose"), null);
  assert.equal(aliasFor("www.youtube.com", "xyzzy"), null);
  assert.equal(packFor("docs.google.com").name, "Google Docs");
});
test("every pack has tips and valid selectors", () => {
  for (const p of PACKS) {
    assert.ok(p.tips.length, p.name);
    for (const a of p.aliases) assert.ok(a.selector && a.say instanceof RegExp && a.label, `${p.name}: ${a.label}`);
  }
});
