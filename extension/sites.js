// Per-site command packs: small, editable lists of "when you say X on this site, press the element matching Y".
// They exist so site-specific knowledge lives in data, not in content.js. A pack is tried only when the page's own labels
// matched nothing, so a pack can never override a button that is really called what you said.
//
//   { name, host: RegExp,                      which sites
//     aliases: [{ say: RegExp, selector, label?, scope? }]   say: matched against what you said (lower case, no punctuation)
//     tips: [string] }                         lines added to "what can I say" on that site
//
// Selectors come from how these sites were built when this was written. Sites change them: if one stops working, the log
// ("show failed commands") shows which phrase missed, and this is the one file to edit. Pure data and one matching function,
// so it can be unit-tested in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceNavSites = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const PACKS = [
    {
      name: "YouTube", host: /(^|\.)youtube\.com$/,
      aliases: [
        // the video's own menu, not a comment's or a recommended video's
        { say: /^(?:three|3) dots?$|^(?:more|more actions|more options|menu|options|ellipsis)$/, selector: "ytd-watch-metadata ytd-menu-renderer button[aria-label], ytd-watch-metadata #actions button[aria-label*='More' i]", label: "More actions" },
        { say: /^share(?: button)?$/, selector: "ytd-watch-metadata button[aria-label^='Share' i], #top-level-buttons-computed button[aria-label^='Share' i]", label: "Share" },
        { say: /^(?:save|save to playlist|playlist)$/, selector: "ytd-watch-metadata button[aria-label^='Save' i]", label: "Save" },
        { say: /^(?:settings|gear|video settings|quality)$/, selector: ".ytp-settings-button", label: "Settings" },
        { say: /^(?:captions?|subtitles?|cc)$/, selector: ".ytp-subtitles-button", label: "Captions" },
        { say: /^(?:autoplay|auto play)$/, selector: ".ytp-autonav-toggle-button", label: "Autoplay" },
        { say: /^(?:search|search box)$/, selector: "input#search, input[name=search_query]", label: "Search" },
        { say: /^(?:home|youtube home)$/, selector: "a#logo, ytd-topbar-logo-renderer a", label: "YouTube home" },
      ],
      tips: ['"comment on this video", then "type ..." and "click comment"', '"share", then "whatsapp" (opens its share link)', '"the three dots" is the video\'s own menu'],
    },
    {
      name: "Google Docs", host: /^docs\.google\.com$/,
      aliases: [
        { say: /^(?:the )?file(?: menu)?$/, selector: "#docs-file-menu", label: "File menu" },
        { say: /^(?:the )?edit(?: menu)?$/, selector: "#docs-edit-menu", label: "Edit menu" },
        { say: /^(?:the )?view(?: menu)?$/, selector: "#docs-view-menu", label: "View menu" },
        { say: /^(?:the )?insert(?: menu)?$/, selector: "#docs-insert-menu", label: "Insert menu" },
        { say: /^(?:the )?format(?: menu)?$/, selector: "#docs-format-menu", label: "Format menu" },
        { say: /^(?:the )?tools(?: menu)?$/, selector: "#docs-tools-menu", label: "Tools menu" },
        { say: /^(?:the )?help(?: menu)?$/, selector: "#docs-help-menu", label: "Help menu" },
        { say: /^(?:ask )?gemini$|^(?:the )?gemini (?:button|panel|icon)$|^help me write$/, selector: "[aria-label*='Gemini' i], [data-tooltip*='Gemini' i], [aria-label*='Help me write' i]", label: "Gemini" },
        { say: /^share(?: button)?$/, selector: "#docs-titlebar-share-client-button, [aria-label^='Share' i][role=button]", label: "Share" },
        { say: /^(?:the )?(?:document )?(?:title|name)$/, selector: "input.docs-title-input", label: "Document title" },
      ],
      tips: ['"type hello in the document", "rename the document to ...", "start voice typing"', '"file", "edit", "insert", "format", "tools" open that menu', '"click gemini" opens the Gemini panel'],
    },
    {
      name: "Gmail", host: /^mail\.google\.com$/,
      aliases: [
        { say: /^(?:compose|new email|new message|write an email|write a mail)$/, selector: "div.T-I.T-I-KE, [gh=cm], [aria-label^='Compose' i]", label: "Compose" },
        { say: /^(?:the )?inbox$/, selector: "a[href$='#inbox'], [aria-label^='Inbox' i]", label: "Inbox" },
        { say: /^(?:the )?sent(?: mail| folder)?$/, selector: "a[href$='#sent']", label: "Sent" },
        { say: /^(?:the )?drafts?$/, selector: "a[href$='#drafts']", label: "Drafts" },
        { say: /^(?:archive)(?: it| this| the email)?$/, selector: "[aria-label='Archive'][role=button], [data-tooltip='Archive']", label: "Archive" },
        { say: /^refresh(?: the inbox)?$/, selector: "[aria-label='Refresh'][role=button], [data-tooltip='Refresh']", label: "Refresh" },
        { say: /^(?:search mail|search email|search box)$/, selector: "input[name=q], input[aria-label^='Search' i]", label: "Search mail" },
      ],
      tips: ['"compose", "open the email from Rahul", "archive", "refresh"'],
    },
    {
      name: "Amazon", host: /(^|\.)amazon\.[a-z.]+$/,
      aliases: [
        { say: /^(?:my )?(?:cart|basket|shopping cart)$/, selector: "#nav-cart", label: "Cart" },
        { say: /^(?:my )?orders?$|^returns and orders$/, selector: "#nav-orders", label: "Orders" },
        { say: /^(?:my )?account(?: and lists)?$|^sign in$/, selector: "#nav-link-accountList", label: "Account" },
        { say: /^(?:search box|search bar|search)$/, selector: "#twotabsearchtextbox", label: "Search" },
      ],
      tips: ['"cart", "orders", "account"'],
    },
  ];

  const packFor = (hostname) => PACKS.find((p) => p.host.test(hostname || "")) || null;

  // The alias for what was said on this host, or null. `said` is lower case with punctuation removed.
  function aliasFor(hostname, said) {
    const pack = packFor(hostname);
    if (!pack) return null;
    const spoken = String(said || "").trim();
    const bare = spoken.replace(/^(?:the|my)\s+/, "");
    const hit = pack.aliases.find((al) => al.say.test(spoken) || al.say.test(bare));
    return hit ? { pack: pack.name, selector: hit.selector, label: hit.label } : null;
  }

  return { PACKS, packFor, aliasFor };
});
