// The log page: every command with its result, grouped so the things that keep failing on a site stand out.
(() => {
  let log = [];
  let filter = "failed";
  let site = "";
  const $ = (id) => document.getElementById(id);

  const text = (tag, s, cls) => { const e = document.createElement(tag); e.textContent = s; if (cls) e.className = cls; return e; };
  const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const tag = (e) => (e.ok ? text("span", "worked", "tag ok") : e.why === "needed help" ? text("span", "needed help", "tag help") : text("span", e.why === "error" ? "error" : "failed", "tag bad"));

  function table(head, rows) {
    const t = document.createElement("table");
    const thead = document.createElement("thead"), tr = document.createElement("tr");
    for (const h of head) tr.append(text("th", h));
    thead.append(tr); t.append(thead);
    const tb = document.createElement("tbody");
    for (const r of rows) { const row = document.createElement("tr"); for (const c of r) { const td = document.createElement("td"); td.append(c); row.append(td); } tb.append(row); }
    t.append(tb);
    return t;
  }

  function render() {
    const scoped = log.filter((e) => !site || e.site === site);
    const bad = scoped.filter((e) => !e.ok), good = scoped.length - bad.length;
    const stats = $("stats");
    stats.replaceChildren();
    for (const [label, n, cls] of [["Worked", good, "ok"], ["Didn't work", bad.length, "bad"], ["Success rate", scoped.length ? Math.round((good / scoped.length) * 100) + "%" : "-", ""]]) {
      const d = text("div", "", "stat " + cls); d.append(text("b", String(n)), document.createTextNode(label)); stats.append(d);
    }

    // sites in the menu, with how many problems each has
    const sites = [...new Set(log.map((e) => e.site))].sort();
    const sel = $("site");
    if (sel.options.length !== sites.length + 1) {
      sel.replaceChildren(new Option("All sites", ""));
      for (const s of sites) sel.append(new Option(`${s} (${log.filter((e) => e.site === s && !e.ok).length} failed)`, s));
      sel.value = site;
    }

    // the same phrase failing on the same site, most often first
    const groups = new Map();
    for (const e of bad) {
      const k = `${e.site}|${e.heard}`;
      const g = groups.get(k) || { e, n: 0, last: 0 };
      g.n++; g.last = Math.max(g.last, e.t); groups.set(k, g);
    }
    const common = [...groups.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 15);
    $("common-h").hidden = $("common").hidden = !common.length;
    $("common").replaceChildren(common.length ? table(["Times", "Site", "You said", "What happened"], common.map(({ e, n }) => [text("span", String(n)), text("span", e.site), text("span", e.heard, "mono"), text("span", e.msg || e.why)])) : text("div", ""));

    const shown = scoped.filter((e) => (filter === "all" ? true : filter === "ok" ? e.ok : !e.ok)).slice().reverse().slice(0, 400);
    $("list").replaceChildren(shown.length
      ? table(["When", "Site", "You said", "It did", "Result"], shown.map((e) => [
        text("span", when(e.t), "dim"), text("span", e.site + (e.path && e.path !== "/" ? e.path : ""), "mono"),
        text("span", e.heard + (e.en ? `  →  ${e.en}` : ""), "mono"), text("span", `${e.cmd}${e.via === "ai" ? " (AI)" : ""}`, "dim"),
        (() => { const c = document.createElement("span"); c.append(tag(e), document.createTextNode(" " + (e.msg || ""))); return c; })(),
      ]))
      : text("div", log.length ? "Nothing here with this filter." : "No commands yet. Turn on voice (Alt+V) and say something.", "empty"));
  }

  function download(name, type, body) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  for (const [id, f] of [["f-failed", "failed"], ["f-ok", "ok"], ["f-all", "all"]]) {
    $(id).addEventListener("click", () => {
      filter = f;
      for (const [i] of [["f-failed"], ["f-ok"], ["f-all"]]) $(i).setAttribute("aria-pressed", String(i === id));
      render();
    });
  }
  $("site").addEventListener("change", (e) => { site = e.target.value; render(); });
  $("dl-json").addEventListener("click", () => download("voicenav-log.json", "application/json", JSON.stringify(log, null, 2)));
  $("dl-csv").addEventListener("click", () => download("voicenav-log.csv", "text/csv",
    ["time,site,path,heard,understood_as,did,via,worked,reason,result,ms", ...log.map((e) => [new Date(e.t).toISOString(), e.site, e.path, e.heard, e.en, e.cmd, e.via, e.ok, e.why, e.msg, e.ms].map(csvCell).join(","))].join("\n")));
  $("clear").addEventListener("click", async () => {
    if (!confirm("Delete the whole log?")) return;
    await chrome.storage.local.remove("vnlog");
  });

  async function load() { log = (await chrome.storage.local.get("vnlog")).vnlog || []; render(); }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.vnlog) { log = ch.vnlog.newValue || []; render(); } });
  load();
})();
