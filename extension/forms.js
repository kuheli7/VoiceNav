// Turning speech into text for forms and dictation. Pure functions (no page access), so they can be tested thoroughly in Node.
//   formatDictation(spoken, before)  "hello comma how are you question mark" -> "Hello, how are you?" (spacing and capitals
//                                    follow what is already in the box, `before`)
//   spokenDigits(spoken)             "nine eight double seven six" -> "987776"
//   spokenEmail(spoken)              "asha dot sharma at gmail dot com" -> "asha.sharma@gmail.com"
//   parseSpokenDate(spoken)          "5th of march 1999" -> "1999-03-05"
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceNavForms = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // ---------------------------------------------------------------- spoken punctuation
  // [spoken words, kind, symbol]. Longest phrases are tried first. English plus the common Hindi/Hinglish ones.
  const PUNCT = [
    ["question mark", "end", "?"], ["prashn chinh", "end", "?"], ["प्रश्न चिह्न", "end", "?"], ["प्रश्नवाचक चिह्न", "end", "?"],
    ["exclamation mark", "end", "!"], ["exclamation point", "end", "!"], ["विस्मयादिबोधक चिह्न", "end", "!"],
    ["full stop", "end", "."], ["purn viram", "end", "."], ["poorn viram", "end", "."], ["पूर्ण विराम", "end", "."], ["फुल स्टॉप", "end", "."],
    ["period", "period", "."],
    ["dot dot dot", "end", "..."], ["ellipsis", "end", "..."],
    ["comma", "mid", ","], ["कॉमा", "mid", ","], ["कोमा", "mid", ","], ["अल्पविराम", "mid", ","],
    ["semicolon", "mid", ";"], ["semi colon", "mid", ";"], ["colon", "mid", ":"],
    ["open bracket", "open", "("], ["open parenthesis", "open", "("], ["close bracket", "close", ")"], ["close parenthesis", "close", ")"],
    ["open quote", "openq", '"'], ["begin quote", "openq", '"'], ["close quote", "closeq", '"'], ["end quote", "closeq", '"'], ["unquote", "closeq", '"'],
    ["new paragraph", "nl2", "\n\n"], ["नया पैराग्राफ", "nl2", "\n\n"], ["naya paragraph", "nl2", "\n\n"],
    ["new line", "nl", "\n"], ["next line", "nl", "\n"], ["नई लाइन", "nl", "\n"], ["नयी लाइन", "nl", "\n"], ["nayi line", "nl", "\n"], ["nai line", "nl", "\n"],
    ["hyphen", "join", "-"],
  ].map(([phrase, kind, sym]) => ({ words: phrase.split(" "), kind, sym })).sort((a, b) => b.words.length - a.words.length);

  const sameWord = (a, b) => a.toLowerCase() === b;

  function tokenize(spoken) {
    const words = spoken.trim().split(/\s+/).filter(Boolean);
    const tokens = [];
    for (let i = 0; i < words.length; i++) {
      const hit = PUNCT.find((p) => p.words.every((w, k) => words[i + k] !== undefined && sameWord(words[i + k], w)));
      if (hit) {
        // "period" is also an ordinary word ("a long period of time"): it only counts as a full stop at the end of what was said
        // (or right before another punctuation word)
        const isLast = i + hit.words.length >= words.length;
        const nextIsPunct = !isLast && PUNCT.some((p) => p.words.every((w, k) => words[i + hit.words.length + k] !== undefined && sameWord(words[i + hit.words.length + k], w)));
        if (hit.kind === "period" && !isLast && !nextIsPunct) { tokens.push({ k: "word", s: words[i] }); continue; }
        tokens.push({ k: hit.kind === "period" ? "end" : hit.kind, s: hit.sym });
        i += hit.words.length - 1;
      } else tokens.push({ k: "word", s: words[i] });
    }
    return tokens;
  }

  // What the text already in the box implies for the next thing typed: does it need a space first, and a capital letter?
  function stateAfter(before) {
    const b = before || "";
    if (!b) return { needSpace: false, cap: true };
    const last = b[b.length - 1];
    const trimmed = b.replace(/\s+$/, "");
    const cap = !trimmed || /[.!?]$/.test(trimmed) || /\n\s*$/.test(b);
    if (/\s/.test(last)) return { needSpace: false, cap };
    if (last === "(" || last === "-") return { needSpace: false, cap };
    if (last === '"') return { needSpace: ((b.match(/"/g) || []).length % 2) === 0, cap }; // an odd number of quotes: we are inside one
    return { needSpace: true, cap };
  }

  function formatDictation(spoken, before = "") {
    if (typeof spoken !== "string" || !spoken.trim()) return "";
    const tokens = tokenize(spoken);
    let { needSpace, cap } = stateAfter(before);
    let out = "";
    for (const t of tokens) {
      if (t.k === "word") {
        let w = t.s;
        if (/^i$/i.test(w) && w === "i") w = "I";
        else if (/^i'(?:m|ll|ve|d)$/.test(w)) w = "I" + w.slice(1);
        if (cap) w = w.charAt(0).toUpperCase() + w.slice(1);
        out += (needSpace ? " " : "") + w;
        needSpace = true; cap = false;
      } else if (t.k === "end") { out += t.s; needSpace = true; cap = true; }
      else if (t.k === "mid") { out += t.s; needSpace = true; cap = false; }
      else if (t.k === "open") { out += (needSpace ? " " : "") + t.s; needSpace = false; }
      else if (t.k === "close") { out += t.s; needSpace = true; }
      else if (t.k === "openq") { out += (needSpace ? " " : "") + t.s; needSpace = false; }
      else if (t.k === "closeq") { out += t.s; needSpace = true; }
      else if (t.k === "nl" || t.k === "nl2") { out += t.s; needSpace = false; cap = true; }
      else if (t.k === "join") { out += t.s; needSpace = false; }
    }
    return out;
  }

  // ---------------------------------------------------------------- digits
  const DIGIT = {
    zero: "0", oh: "0", o: "0", one: "1", won: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4", fore: "4", five: "5", six: "6",
    seven: "7", eight: "8", ate: "8", nine: "9",
    shunya: "0", ek: "1", do: "2", teen: "3", char: "4", chaar: "4", paanch: "5", panch: "5", chhe: "6", che: "6", chhah: "6", chah: "6",
    saat: "7", aath: "8", ath: "8", nau: "9",
    "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पांच": "5", "पाँच": "5", "छह": "6", "छः": "6", "छे": "6", "सात": "7", "आठ": "8", "नौ": "9",
  };
  const MULTIPLY = { double: 2, triple: 3, "डबल": 2, "ट्रिपल": 3 };
  const TENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const FILLER = new Set(["and", "then", "dash", "space", "hyphen", "please", "aur", "फिर", "और"]);

  function spokenDigits(spoken) {
    if (typeof spoken !== "string") return null;
    const text = spoken.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
    const words = text.toLowerCase().replace(/[,.]/g, " ").split(/\s+/).filter(Boolean);
    let out = "", times = 1, plus = false;
    const UNIT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (i === 0 && w === "plus") { plus = true; continue; }
      if (MULTIPLY[w]) { times = MULTIPLY[w]; continue; }
      if (FILLER.has(w)) continue;
      if (TENS[w] !== undefined) { // "twenty five" is 25, "thirteen" is 13
        let v = TENS[w];
        if (v >= 20 && UNIT[words[i + 1]]) { v += UNIT[words[i + 1]]; i++; }
        out += String(v).repeat(times); times = 1;
        continue;
      }
      if (DIGIT[w] !== undefined) { out += DIGIT[w].repeat(times); times = 1; continue; }
      if (/^[\d\-()]+$/.test(w)) { const d = w.replace(/\D/g, ""); if (!d) return null; out += d.repeat(times); times = 1; continue; }
      return null; // a word that is not a digit: better to say so than to type a wrong number
    }
    if (!out || times > 1) return null; // "nine double" ends on a "double" with nothing to double
    return (plus ? "+" : "") + out;
  }

  // ---------------------------------------------------------------- email addresses
  function spokenEmail(spoken) {
    if (typeof spoken !== "string") return null;
    let words = spoken.trim().replace(/[.,!?]+$/, "").replace(/[,]/g, " ").split(/\s+/).filter(Boolean); // a recogniser often adds a full stop at the end
    let out = "";
    for (let i = 0; i < words.length; i++) {
      const w = words[i].toLowerCase();
      const next = (words[i + 1] || "").toLowerCase(), next2 = (words[i + 2] || "").toLowerCase();
      if (w === "at" && next === "the" && next2 === "rate") { out += "@"; i += 2; }
      else if ((w === "एट" && next === "द" && next2 === "रेट")) { out += "@"; i += 2; }
      else if (w === "at" || w === "एट" || w === "@" || (w === "at" && next === "sign")) { out += "@"; if (next === "sign") i += 1; }
      else if (w === "dot" || w === "point" || w === "डॉट" || w === "डाट") out += ".";
      else if (w === "underscore" || w === "अंडरस्कोर") out += "_";
      else if (w === "dash" || w === "hyphen" || w === "minus") out += "-";
      else if (w === "plus") out += "+";
      else if (DIGIT[w] !== undefined && !(w === "to" || w === "too" || w === "for" || w === "fore" || w === "do" || w === "o" || w === "oh" || w === "won" || w === "ate" || w === "che")) out += DIGIT[w];
      else out += w;
    }
    const at = out.indexOf("@");
    if (at < 1 || out.indexOf("@", at + 1) !== -1) return null;     // exactly one @, with something before it
    if (!/\.[a-z]{2,}$/.test(out.slice(at))) return null;            // and a dot-something after it
    return out;
  }

  // ---------------------------------------------------------------- dates
  const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const daysIn = (m, y) => [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  const pad = (n) => String(n).padStart(2, "0");

  function parseSpokenDate(spoken) {
    if (typeof spoken !== "string") return null;
    const t = spoken.toLowerCase().replace(/^\s*the\s+/, "").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; } // 05/03/1999 is the 5th of March (day first)
    else if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+) (\d{4})$/)) && MONTHS[m[2]]) { d = +m[1]; mo = MONTHS[m[2]]; y = +m[3]; }
    else if ((m = t.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/)) && MONTHS[m[1]]) { mo = MONTHS[m[1]]; d = +m[2]; y = +m[3]; }
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(mo, y) || y < 1000 || y > 2999) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  // ---------------------------------------------------------------- editing what is already in a box
  // "delete last word": drops the last word and the space before it
  function deleteLastWord(text) {
    if (typeof text !== "string") return "";
    return text.replace(/\s+$/, "").replace(/\S*$/, "").replace(/[ \t]+$/, "");
  }
  // "delete last sentence": drops the last sentence, keeping the earlier ones as they were
  function deleteLastSentence(text) {
    if (typeof text !== "string") return "";
    const body = text.replace(/\s+$/, "").replace(/[.!?]+$/, "");
    // a full stop ends a sentence only when a space or line follows ("3.14" does not)
    let cut = -1, hit;
    const re = /[.!?](?=\s)|\n/g;
    while ((hit = re.exec(body))) cut = hit.index;
    return cut < 0 ? "" : body.slice(0, cut + 1).replace(/[ \t]+$/, "");
  }

  return { formatDictation, deleteLastWord, deleteLastSentence, spokenDigits, spokenEmail, parseSpokenDate, tokenize };
});
