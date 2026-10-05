// Universal result detector: finds the list of results on ANY page (search results, product grids, video lists, news
// items, forum topics) with no per-site rule. A results list is many similar sibling blocks that each hold one main link;
// we look for that shape, score the candidates, and pick the best. It runs in the user's own browser on the page they are
// already looking at; nothing is downloaded or sent anywhere.
//
// detect(doc) -> { results: [{ card, link, price }], rule, score } | null
//   `rule` is a small, serialisable description ({ card, link, price } as CSS selectors) that apply() can re-run later,
//   so a site only has to be analysed once. It never contains code, only selectors.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceNavDetector = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const PRICE = /(?:₹|rs\.?|inr|\$|€|£)\s?(\d[\d,]*(?:\.\d+)?)/i;
  // Lists inside these are never the page's results (menus, footers); sidebars and page headers are discounted, not banned
  const HARD_CHROME = "nav,footer,[role=navigation],[role=contentinfo],[role=menu],[role=menubar],[role=tablist]";
  const SOFT_CHROME = "aside,header,[role=complementary],[role=banner],[role=dialog]";
  const MIN_SCORE = 40;
  const BUDGET_MS = 400;
  const HEADING = "h1,h2,h3,h4,h5,[role=heading]";
  const MIN_CARDS = 3;
  const MAX_DEPTH = 24; // Amazon's result cards sit about 14 levels above their title links

  const textOf = (el) => ((el.getAttribute("aria-label") || el.innerText || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " "));

  function visible(el) {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  }

  // Class names that are meaningful and stable. Build tools generate names like "css-1x9fj" or "sc-a8b3d2" that change
  // on every release; a rule built on those would break, so they are ignored.
  function stableClass(c) {
    if (c.length > 32 || c.length < 2) return false;
    if (!/^[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*$/.test(c)) return false;
    if (/^(?:css|sc|jsx|emotion|styled|svelte|ember|astro|_)[-_]?[A-Za-z0-9]{3,}$/.test(c)) return false;
    if (/\d{4,}/.test(c)) return false;
    if (/^[a-z]+[A-Z0-9]/.test(c) && /\d/.test(c) && c.length > 8) return false; // looks hashed: lower, then mixed case and digits
    return true;
  }
  const stableClasses = (el) => [...el.classList].filter(stableClass);
  const stableId = (el) => (el.id && /^[A-Za-z][A-Za-z0-9_-]{1,30}$/.test(el.id) && !/\d{3,}/.test(el.id) ? el.id : null);

  // Links worth considering: visible, go somewhere, and have a readable name
  function candidateLinks(doc, tooSlow) {
    const out = [];
    let seen = 0;
    for (const a of doc.querySelectorAll("a[href]")) {
      if ((++seen & 63) === 0 && tooSlow && tooSlow()) return out; // the caller gives up when the budget is spent
      const href = a.getAttribute("href") || "";
      if (!href || href === "#" || /^(?:javascript|mailto|tel):/i.test(href)) continue;
      // "Kindle" or "Pixel 9" is a perfectly good title when it is a heading; elsewhere a link needs a few words to count
      const inHeading = a.matches(HEADING) || !!a.querySelector(HEADING) || !!a.closest(HEADING);
      if (textOf(a).length < (inHeading ? 2 : 8) || !visible(a)) continue;
      out.push(a);
    }
    return out;
  }

  // The link in a card that a person would call "the result": the one wrapping a heading, else the one with the most words
  function mainLinkOf(card, linkSet) {
    const links = [...card.querySelectorAll("a[href]")].filter((a) => linkSet.has(a));
    if (!links.length) return null;
    const withHeading = links.filter((a) => a.matches(HEADING) || a.querySelector(HEADING) || a.closest(HEADING));
    const pool = withHeading.length ? withHeading : links;
    return pool.reduce((best, a) => (textOf(a).length > textOf(best).length ? a : best), pool[0]);
  }

  function cluster(members) {
    // members that share the classes most of them have; a few "odd/ad/featured" extras must not split a list in two
    const freq = new Map();
    for (const m of members) for (const c of stableClasses(m)) freq.set(c, (freq.get(c) || 0) + 1);
    const core = [...freq].filter(([, n]) => n >= members.length * 0.6).map(([c]) => c);
    return members.filter((m) => core.every((c) => m.classList.contains(c)));
  }

  function scoreCluster(members, linkSet, doc) {
    const cards = [];
    for (const m of members) {
      const link = mainLinkOf(m, linkSet);
      if (link) cards.push({ card: m, link });
    }
    if (cards.length < MIN_CARDS) return null;
    const lens = cards.map((c) => textOf(c.link).length).sort((a, b) => a - b);
    const avgLen = lens.reduce((s, n) => s + n, 0) / lens.length;
    const q1 = lens[Math.floor(lens.length / 4)];
    const effLen = 0.5 * avgLen + 0.5 * q1;            // a list where a quarter of the "titles" are tiny is probably two kinds of row
    const lenCv = Math.sqrt(lens.reduce((s, n) => s + (n - avgLen) ** 2, 0) / lens.length) / (avgLen || 1);
    const distinct = new Set(cards.map((c) => c.link.href)).size / cards.length;
    const heights = cards.map((c) => c.card.getBoundingClientRect().height);
    const mean = heights.reduce((s, h) => s + h, 0) / heights.length || 1;
    const cv = Math.sqrt(heights.reduce((s, h) => s + (h - mean) ** 2, 0) / heights.length) / mean;
    const area = cards.reduce((s, c) => { const r = c.card.getBoundingClientRect(); return s + r.width * r.height; }, 0);
    const view = Math.max(1, (doc.defaultView?.innerWidth || 1280) * (doc.defaultView?.innerHeight || 800));
    const parent = members[0].parentElement;
    if (parent?.closest(HARD_CHROME)) return null;
    const soft = !!parent?.closest(SOFT_CHROME);
    const hasHeading = cards.filter((c) => c.link.matches(HEADING) || c.link.querySelector(HEADING) || c.card.querySelector(HEADING)).length / cards.length;

    // a title inside a heading is strong evidence even when it is short ("Kindle", "Pixel 9")
    const titleLen = hasHeading > 0.8 ? Math.max(effLen, 15) : effLen;
    let score = Math.min(cards.length, 40) * Math.min(titleLen, 80);
    score *= 1 - Math.min(0.5, lenCv * 0.5);
    score *= distinct;                                   // image link + title link to the same place must not look like two results
    score *= 1 - Math.min(0.6, cv * 0.5);                // cards in a list have similar heights
    score *= 1 + hasHeading * 0.3;
    score *= Math.sqrt(Math.min(4, Math.max(0.05, area / view)));
    if (soft) score *= 0.3;                              // sidebars are lists too, but not the point of the page
    // products and videos have pictures or prices; a plain list of short labels is more likely navigation
    const rich = cards.filter((c) => c.card.querySelector("img,picture,video,svg") || PRICE.test((c.card.textContent || "").slice(0, 600))).length / cards.length;
    score *= 1 + rich * 0.5;
    if (titleLen < 15) score *= 0.6;                       // short labels look like navigation
    if (distinct < 0.6) score *= 0.3;
    return { cards, score };
  }

  function priceOf(card) {
    const m = (card.textContent || "").slice(0, 600).match(PRICE);
    return m ? parseFloat(m[1].replace(/,/g, "")) : null;
  }

  // ---- turning a detection into a small reusable rule ----
  const cssEscape = (s) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^A-Za-z0-9_-]/g, "\\$&"));

  function pieceFor(el) {
    const id = stableId(el);
    if (id) return "#" + cssEscape(id);
    const cls = stableClasses(el).slice(0, 2).map((c) => "." + cssEscape(c)).join("");
    return el.tagName.toLowerCase() + cls;
  }

  function sameSet(found, members) {
    const want = new Set(members);
    let hit = 0;
    for (const el of found) if (want.has(el)) hit++;
    return hit === members.length && found.length === members.length;
  }

  function deriveCardSelector(members, doc) {
    const first = members[0];
    const tag = first.tagName.toLowerCase();
    const shared = stableClasses(first).filter((c) => members.every((m) => m.classList.contains(c))).slice(0, 3);
    const base = tag + shared.map((c) => "." + cssEscape(c)).join("");
    const attrs = [];
    for (const a of first.attributes) {
      if (!/^(?:data-[\w-]+|role|itemtype)$/.test(a.name) || a.value.length > 40 || /\d{5,}/.test(a.value)) continue;
      if (members.every((m) => m.getAttribute(a.name) === a.value)) attrs.push(`${tag}[${a.name}="${a.value.replace(/"/g, "")}"]`);
    }
    const parent = first.parentElement;
    const prefixes = [""];
    if (parent) {
      const p1 = pieceFor(parent);
      prefixes.push(p1 + " > ");
      if (parent.parentElement) prefixes.push(pieceFor(parent.parentElement) + " > " + p1 + " > ");
    }
    for (const sel of [...attrs, base]) {
      for (const prefix of prefixes) {
        const full = prefix + sel;
        try { if (sameSet([...doc.querySelectorAll(full)], members)) return full; } catch { /* a selector we built was invalid: try the next */ }
      }
    }
    return null;
  }

  function deriveLinkSelector(cards) {
    const tries = ["h1 a, h2 a, h3 a, h4 a, h5 a, [role=heading] a", "a:has(> h1, > h2, > h3, > h4, > h5)", "a:has(h1, h2, h3, h4, h5)"];
    const shared = stableClasses(cards[0].link).filter((c) => cards.every((x) => x.link.classList.contains(c)));
    for (const c of shared.slice(0, 2)) tries.push("a." + cssEscape(c));
    // no hook on the link itself: use its parent's class ("span.titleline > a"), common when the title sits in a styled wrapper
    const parentClass = stableClasses(cards[0].link.parentElement || cards[0].link).filter((c) => cards.every((x) => x.link.parentElement && x.link.parentElement.classList.contains(c)));
    for (const c of parentClass.slice(0, 2)) tries.push("." + cssEscape(c) + " > a");
    tries.push("a[href]");
    for (const sel of tries) {
      let ok = 0;
      try { for (const x of cards) if (x.card.querySelector(sel) === x.link) ok++; } catch { continue; }
      if (ok >= cards.length * 0.9) return sel;
    }
    return null;
  }

  function derivePriceSelector(cards) {
    const first = cards.find((c) => PRICE.test(c.card.textContent || ""));
    if (!first) return null;
    const el = [...first.card.querySelectorAll("*")].find((e) => !e.children.length && PRICE.test(e.textContent || ""));
    const classes = el ? stableClasses(el) : [];
    for (const c of classes) {
      const sel = "." + cssEscape(c);
      const ok = cards.filter((x) => { const e = x.card.querySelector(sel); return e && PRICE.test(e.textContent || ""); }).length;
      if (ok >= cards.filter((x) => PRICE.test(x.card.textContent || "")).length * 0.9) return sel;
    }
    return null; // no stable hook: read the price from the card's text instead
  }

  function detect(doc = document, opts = {}) {
    const tried = [];
    const t0 = performance.now();
    const tooSlow = () => performance.now() - t0 > BUDGET_MS; // a huge page must never make a voice command feel frozen
    const links = candidateLinks(doc, tooSlow);
    if (links.length < MIN_CARDS || tooSlow()) return null;
    const linkSet = new Set(links);

    // every ancestor (a few levels up) of a candidate link, grouped by (parent, tag): siblings of the same kind
    const owners = new Set();
    for (const a of links) {
      if (tooSlow()) return null;
      let el = a;
      for (let d = 0; d < MAX_DEPTH && el && el !== doc.body && el !== doc.documentElement; d++, el = el.parentElement) owners.add(el);
    }
    const groups = new Map();
    for (const el of owners) {
      const p = el.parentElement;
      if (!p) continue;
      let byTag = groups.get(p);
      if (!byTag) groups.set(p, (byTag = new Map()));
      const arr = byTag.get(el.tagName) || [];
      arr.push(el);
      byTag.set(el.tagName, arr);
    }

    // Candidate card sets: each (parent, tag) group, and each exact class signature within it (a table with title rows and sub-rows)
    const candidates = [];
    for (const byTag of groups.values()) {
      for (const members of byTag.values()) {
        if (members.length < MIN_CARDS) continue;
        const sets = [cluster(members)];
        const bySig = new Map();
        for (const m of members) {
          const k = stableClasses(m).sort().join(" ");
          bySig.set(k, [...(bySig.get(k) || []), m]);
        }
        if (bySig.size > 1) for (const arr of bySig.values()) if (arr.length >= MIN_CARDS) sets.push(arr);
        for (const set of sets) if (set.length >= MIN_CARDS) candidates.push(set);
      }
    }

    // Grids built from rows ("three cards per row"): each row alone is too small to look like a list. Merge the sets that hold
    // the same kind of card, under the same kind of row, inside the same container.
    const kindOf = (set) => `${pieceFor(set[0])}@${pieceFor(set[0].parentElement)}`;
    const byContainer = new Map();
    for (const set of candidates) {
      const container = set[0].parentElement && set[0].parentElement.parentElement;
      if (!container) continue;
      let kinds = byContainer.get(container);
      if (!kinds) byContainer.set(container, (kinds = new Map()));
      const k = kindOf(set);
      let entry = kinds.get(k);
      if (!entry) kinds.set(k, (entry = { members: new Set(), rows: new Set() }));
      for (const m of set) entry.members.add(m);
      entry.rows.add(set[0].parentElement);
    }
    const rowSets = [];
    for (const kinds of byContainer.values()) {
      for (const { members, rows } of kinds.values()) {
        // only a real merge: cards spread over two or more rows, counted once each
        if (rows.size >= 2 && members.size >= MIN_CARDS * 2) rowSets.push([...members].sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)));
      }
    }
    candidates.push(...rowSets);

    let best = null;
    for (const set of candidates) {
      if (tooSlow()) return null;
      const scored = scoreCluster(set, linkSet, doc);
      if (scored && opts.debug) tried.push({ score: Math.round(scored.score), n: scored.cards.length, parent: pieceFor(set[0].parentElement || set[0]), card: pieceFor(set[0]), sample: textOf(scored.cards[0].link).slice(0, 40) });
      if (scored && (!best || scored.score > best.score)) best = { ...scored, members: set };
    }
    if (!best || best.score < MIN_SCORE || tooSlow()) return null;

    const cards = best.cards;
    const rule = (() => {
      const card = deriveCardSelector(cards.map((c) => c.card), doc);
      return card ? { card, link: deriveLinkSelector(cards), price: derivePriceSelector(cards), n: cards.length } : null;
    })();
    return {
      results: cards.map((c) => ({ card: c.card, link: c.link, price: priceOf(c.card) })),
      rule: rule && rule.link ? rule : null,
      score: best.score,
      tried: opts.debug ? tried.sort((a, b) => b.score - a.score).slice(0, 8) : undefined,
    };
  }

  // Re-run a saved rule. Returns [] when it no longer matches, so the caller can discard it and detect again.
  function apply(rule, doc = document) {
    let cards;
    try { cards = [...doc.querySelectorAll(rule.card)]; } catch { return []; }
    const out = [];
    for (const card of cards) {
      let link = null;
      try { link = card.querySelector(rule.link); } catch { return []; }
      if (!link || !link.getAttribute("href") || !visible(link)) continue;
      let price = null;
      if (rule.price) {
        const e = card.querySelector(rule.price);
        const m = e && (e.textContent || "").match(PRICE);
        price = m ? parseFloat(m[1].replace(/,/g, "")) : null;
      } else price = priceOf(card);
      out.push({ card, link, price });
    }
    return out;
  }

  return { detect, apply, mainLinkOf, candidateLinks, stableClass };
});
