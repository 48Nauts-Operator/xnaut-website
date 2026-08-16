// Builds /plugins/ — the index, one page per plugin, and the JSON the index
// searches over.
//
// Follows the design in the vault:
// work/xNAUT/Development/features/2026-08-16_Marketplace-Page-Design.md
// A directory rather than one page, because the long tail is the point: someone
// searching "notion mcp server" should land on a page about Notion.
//
// The data is the app's own library — hand-written seeds first, then the
// compiled catalogue, deduplicated by id — exported from the xNAUT repo:
//
//   cargo test --bin xnaut plugins::tests::export_public_catalogue -- --ignored --nocapture
//
// Drop that output over data/plugins.json and run `node scripts/build-plugins.mjs`.
//
// The export carries fields that must never be published. `env` holds default
// VALUES, one of which is a private Tailscale hostname, and Pages serves this
// whole repository, so data/plugins.json is a public URL. Every entry is
// projected down to publishable fields and the data file is rewritten with the
// projection, so a raw export dropped in here is stripped on the next build
// rather than published.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

// ---------------------------------------------------------------- the data

const PUBLIC_FIELDS = ["id", "name", "description", "category", "transport",
  "command", "args", "url", "required_env", "note", "skills", "docs_url", "seeded"];

// A host only THIS network can reach must not appear on a public page: the
// live case is the Forgejo entry's Tailscale name, which came through in the
// export's `env` defaults.
//
// `localhost` is deliberately NOT in here. Several MCP servers genuinely are
// local endpoints — Rill answers on http://localhost:9009 for everyone who runs
// it — so that is a public fact about the product rather than a leak, and
// stripping it would make the page wrong.
const PRIVATE_HOST = /(\.ts\.net|tail[0-9a-f]{6,}|\b192\.168\.\d+\.\d+|\b10\.\d+\.\d+\.\d+)/i;

// A note written for the in-app library can be about THIS machine — "already
// installed here at ~/.local/bin/…" is true in the app and meaningless on a
// public page. Those are dropped; the rest are kept, because the setup step
// outside xNAUT is the most useful field on the page and no registry has it.
const LOCAL_NOTE = /\b(installed here|already installed|on this machine)\b/i;

const publishable = (plugin) => {
  const kept = {};
  for (const field of PUBLIC_FIELDS) {
    const value = plugin[field];
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    if (field === "note" && LOCAL_NOTE.test(String(value))) continue;
    kept[field] = value;
  }
  // `env` is dropped wholesale — names live in required_env, values never leave
  // the machine.
  if (kept.url && PRIVATE_HOST.test(kept.url)) delete kept.url;
  if (kept.command && PRIVATE_HOST.test([kept.command, ...(kept.args || [])].join(" "))) {
    delete kept.command;
    delete kept.args;
  }
  return kept;
};

const dataPath = new URL("../data/plugins.json", import.meta.url);
const plugins = JSON.parse(readFileSync(dataPath, "utf8")).map(publishable);
writeFileSync(dataPath, `${JSON.stringify(plugins, null, 2)}\n`);

// The app's own order, from src/js/plugins-panel.js, with anything unknown
// falling to Other at the bottom — the same fallback the panel uses.
const CATEGORY_ORDER = ["Dev", "Docs & search", "Knowledge", "Work tracking", "Comms", "Business", "Design", "Other"];
const rank = (category) => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
};
const categories = [...new Set(plugins.map((p) => p.category))].sort((a, b) => rank(a) - rank(b));

// What an unauthenticated MCP `initialize` actually got back, per endpoint.
// Written by scripts/probe-endpoints.mjs; see plugins/reachability.json for the
// date and the method. This is the credential-free half of the "verified" tier
// the design paper defines: a measurement with a date on it, never an opinion.
//
// It exists because the declaration lies. 82 of the 95 HTTP entries declare no
// credential, which the library reads as ready; probed on 2026-08-16, 80 of
// them answered 401 or 403.
let reachability = { checked: "", results: {} };
try {
  reachability = JSON.parse(readFileSync(new URL("../plugins/reachability.json", import.meta.url), "utf8"));
} catch { /* no probe run yet: the page simply says nothing about reachability */ }

const REACH_LABEL = {
  open: "answered with no account",
  auth: "sign-in required",
  answered: "answered, non-standard reply",
  unreachable: "did not answer",
  "needs-its-url": "needs its URL",
};
// A probe result we have no label for must never fall back to the DECLARED
// state: an endpoint that answered 307 was being shown as ready because
// "http-307" was not in the map above.
const reach = (plugin) => {
  const state = reachability.results[plugin.id];
  if (!state) return null;
  return REACH_LABEL[state] || `answered ${state.replace("http-", "HTTP ")}`;
};

// The same rule as blocker() in src-tauri/src/plugins.rs, so the site and the
// library never disagree about whether a plugin is ready to run.
const blocker = (plugin) => {
  if (plugin.transport === "http" && !plugin.url) return "needs its URL";
  if (plugin.transport === "stdio" && !plugin.command) return "needs a command";
  const [first] = plugin.required_env || [];
  if (first) return `needs ${first}`;
  return null;
};

const connector = (plugin) => (plugin.transport === "http"
  ? plugin.url || ""
  : [plugin.command, ...(plugin.args || [])].filter(Boolean).join(" "));

// A monogram tile, coloured from the id. Brand marks are a trademark question
// on a public page, not a licence one (design paper, open question 7), so the
// site uses initials and the app keeps its simple-icons set.
const tile = (plugin, klass = "plg-mark") => {
  let hash = 0;
  for (let i = 0; i < plugin.id.length; i += 1) hash = (hash * 31 + plugin.id.charCodeAt(i)) % 360;
  return `<span class="${klass}" style="background:hsl(${hash} 38% 26%);color:hsl(${hash} 70% 74%)" aria-hidden="true">${esc(plugin.name.trim().charAt(0).toUpperCase() || "?")}</span>`;
};

const ANALYTICS = '<script defer src="https://wave.21nauts.com/script.js" data-website-id="6bb927bb-b2fd-486f-924c-df55c043bcad"></script>';

const head = ({ title, description, canonical, extraStyle = "" }) => `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta name="author" content="André">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="https://xnaut.dev/assets/og-v2.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=4">
${extraStyle}  ${ANALYTICS}
</head>`;

const nav = `<nav class="nav">
  <a class="logo" href="/">
    <span class="logo-mark">xN</span>
    <span class="logo-name">xNAUT</span>
  </a>
  <div class="nav-actions">
    <a href="/plugins/">← All plugins</a>
    <a class="btn btn-primary btn-sm" href="https://github.com/48Nauts-Operator/xNaut/releases/latest">Download latest</a>
  </div>
</nav>`;

const navIndex = nav.replace('<a href="/plugins/">← All plugins</a>', '<a href="/">← xnaut.dev</a>');

const footer = `<footer class="footer">
  <div class="logo">
    <span class="logo-mark sm">xN</span>
    <span class="fine">© 2026 48Nauts · MIT License</span>
  </div>
  <div class="footer-links">
    <a href="/blog/">Blog</a>
    <a href="/plugins/">Plugins</a>
    <a href="/releases.html">Releases</a>
    <a href="/loom.html">Loom</a>
    <a href="https://docs.xnaut.dev/docs">Docs</a>
    <a href="/">xnaut.dev</a>
  </div>
</footer>`;

// ---------------------------------------------------------------- styles

const SHARED_STYLE = `  <style>
    .plg-lead { font-size: 17px; line-height: 1.55; color: var(--text-soft); margin: 22px 0 0; max-width: 74ch; }
    .plg-mark { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px;
                border-radius: 9px; font-family: var(--mono); font-size: 13px; font-weight: 700; }
    .plg-mark.big { width: 46px; height: 46px; flex-basis: 46px; border-radius: 12px; font-size: 19px; }
    .plg-cat { padding: 3px 8px; border: 1px solid var(--border-card); border-radius: 6px;
               font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
    .plg-conn { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 9px;
                background: var(--panel-deep); border: 1px solid var(--border-card); }
    /* min-width:0 on both, or the nowrap command sets the column's width and
       the whole page scrolls sideways: measured 933px columns inside a 696px
       grid before this line existed. */
    .plg-conn { min-width: 0; }
    .plg-conn code { flex: 1 1 auto; min-width: 0; overflow-x: auto; white-space: nowrap;
                     font-family: var(--mono); font-size: 12.5px; color: var(--text-soft); }
    .plg-copy { flex: 0 0 auto; padding: 3px 9px; border: 1px solid var(--border-card); border-radius: 6px;
                background: transparent; color: var(--faint); font-family: var(--mono); font-size: 11px;
                cursor: pointer; }
    .plg-copy:hover { color: var(--text-soft); }
    .plg-copy.ok { color: var(--green); border-color: var(--green); }
    .plg-state { font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
    .plg-state.ready { color: var(--green); }
    .plg-note { border-left: 2px solid var(--amber); background: var(--panel); padding: 16px 20px;
                border-radius: 0 10px 10px 0; font-size: 15px; color: var(--text-soft); line-height: 1.65; }
  </style>`;

const INDEX_STYLE = `${SHARED_STYLE}
  <style>
    /* .legal is the site's 760px reading column, right for a text page and far
       too narrow for a catalogue. Widen it for this page only, and keep every
       other .legal rule. */
    main.legal.plg-page { max-width: 1240px; }
    .plg-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 28px 0 0; }
    .plg-search { flex: 1 1 220px; min-width: 190px; padding: 10px 14px; border: 1px solid var(--border-card);
                  border-radius: 10px; background: var(--panel-deep); color: var(--text);
                  font-family: var(--sans); font-size: 14px; }
    .plg-search::placeholder { color: var(--faint); }
    .plg-search:focus { outline: none; border-color: #3A3E46; }
    .plg-filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .plg-filter { padding: 7px 13px; border: 1px solid var(--border-card); border-radius: 999px;
                  background: transparent; color: var(--muted); font-family: var(--sans); font-size: 13px;
                  cursor: pointer; transition: color .15s, border-color .15s; }
    .plg-filter:hover { color: var(--text-soft); }
    .plg-filter.on { border-color: #6B5320; background: var(--amber-ink); color: var(--amber); }
    .plg-count { font-family: var(--mono); font-size: 12.5px; color: var(--faint); margin: 16px 0 4px; }
    .plg-group { margin: 30px 0 0; }
    .plg-group[hidden] { display: none; }
    .plg-group h2 { font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: .08em;
                    text-transform: uppercase; color: var(--faint); margin: 0 0 12px; }
    .plg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 16px; }
    .plg { display: flex; flex-direction: column; gap: 11px; min-width: 0; padding: 20px;
           background: var(--panel); border: 1px solid var(--border-card); border-radius: 14px;
           text-decoration: none; transition: border-color .15s; }
    /* display:flex beats the hidden attribute, so filtering would show every
       card while claiming to have hidden them. */
    .plg[hidden] { display: none; }
    .plg:hover { border-color: #2A2E36; }
    .plg-head { display: flex; align-items: center; gap: 11px; }
    .plg-head h3 { flex: 1 1 auto; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; margin: 0;
                   color: var(--text); }
    .plg p { flex: 1 1 auto; font-size: 14px; line-height: 1.55; color: var(--muted); margin: 0; }
    .plg .plg-conn { padding: 7px 10px; }
    .plg .plg-conn code { font-size: 11.5px; }
    .plg-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
    .plg-foot .go { margin-left: auto; color: var(--amber); }
    .plg-empty { padding: 34px 0; color: var(--faint); font-size: 14px; }
    .plg-head h3 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>`;

const DETAIL_STYLE = `${SHARED_STYLE}
  <style>
    .plg-hero { display: flex; align-items: center; gap: 15px; margin: 6px 0 0; }
    .plg-hero h1 { margin: 0; }
    .plg-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 20px 0 0; }
    .plg-sec { border-top: 1px solid var(--border-card); padding-top: 22px; margin-top: 30px; }
    .plg-sec h2 { font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: .08em;
                  text-transform: uppercase; color: var(--faint); margin: 0 0 12px; }
    .plg-sec p { font-size: 15px; line-height: 1.65; color: var(--text-soft); margin: 0 0 10px; max-width: 74ch; }
    .plg-env { list-style: none; padding: 0; margin: 0 0 12px; }
    .plg-env li { display: flex; gap: 12px; align-items: baseline; padding: 8px 0;
                  border-bottom: 1px solid var(--border-card); font-size: 14px; color: var(--text-soft); }
    .plg-env li:last-child { border-bottom: 0; }
    .plg-env b { font-family: var(--mono); font-size: 12.5px; color: var(--amber); font-weight: 400; }
    .plg-skills { display: flex; flex-wrap: wrap; gap: 7px; margin: 0; padding: 0; list-style: none; }
    .plg-skills li { padding: 5px 10px; border: 1px solid var(--border-card); border-radius: 999px;
                     background: var(--panel); font-family: var(--mono); font-size: 11.5px; color: var(--text-soft); }
    .plg-steps { margin: 0; padding-left: 20px; }
    .plg-steps li { font-size: 15px; line-height: 1.65; color: var(--text-soft); margin: 6px 0; }
    .plg-related { display: flex; flex-wrap: wrap; gap: 8px; }
    .plg-related a { padding: 6px 11px; border: 1px solid var(--border-card); border-radius: 999px;
                     font-size: 13px; color: var(--text-soft); text-decoration: none; }
    .plg-related a:hover { border-color: #2A2E36; color: var(--text); }
  </style>`;

// ---------------------------------------------------------------- the index

const card = (plugin) => {
  const state = blocker(plugin);
  // A measurement outranks a declaration wherever we have one.
  const measured = reach(plugin);
  const line = connector(plugin);
  const skills = (plugin.skills || []).length;
  const haystack = `${plugin.name} ${plugin.description} ${plugin.category} ${(plugin.skills || []).join(" ")} ${line} ${measured || ""}`;
  return `      <a class="plg" href="/plugins/${esc(plugin.id)}.html" data-category="${esc(plugin.category)}"
         data-ready="${measured ? (measured === "answered with no account" ? "1" : "0") : (state ? "0" : "1")}" data-search="${esc(haystack.toLowerCase())}">
        <span class="plg-head">${tile(plugin)}<h3>${esc(plugin.name)}</h3><span class="plg-cat">${esc(plugin.category)}</span></span>
        <p>${esc(plugin.description)}</p>
        ${line ? `<span class="plg-conn"><code>${esc(line)}</code></span>` : ""}
        <span class="plg-foot">
          <span class="plg-state${measured === "answered with no account" ? " ready" : ""}">${esc(measured || state || "no credential declared")}</span>
          ${skills ? `<span>${skills} skill${skills === 1 ? "" : "s"}</span>` : ""}
          <span class="go">open →</span>
        </span>
      </a>`;
};

const readyCount = plugins.filter((plugin) => !blocker(plugin)).length;
const skillCount = plugins.reduce((total, plugin) => total + (plugin.skills || []).length, 0);

const groups = categories.map((category) => {
  const rows = plugins
    .filter((plugin) => plugin.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));
  return `    <section class="plg-group" data-group="${esc(category)}">
      <h2>${esc(category)} · ${rows.length}</h2>
      <div class="plg-grid">
${rows.map(card).join("\n")}
      </div>
    </section>`;
}).join("\n");

const filters = ["All", ...categories]
  .map((name, index) => `      <button class="plg-filter${index === 0 ? " on" : ""}" data-filter="${esc(name)}">${esc(name)}</button>`)
  .join("\n");

const indexDescription = `${plugins.length} MCP servers xNAUT can hand an agent, shipping ${skillCount} skills between them. Not a store — xNAUT reads the public registries, runs what it can, and says which is which.`;

const indexPage = `<!doctype html>
<html lang="en">
${head({
  title: "Plugins | xNAUT",
  description: indexDescription,
  canonical: "https://xnaut.dev/plugins/",
  extraStyle: `${INDEX_STYLE}\n`,
})}
<body>

${navIndex}

<main class="legal plg-page">
  <h1>Plugins</h1>
  <span class="updated">Everything xNAUT can hand an agent</span>

  <p class="plg-lead">A plugin is an MCP server. xNAUT does not host, sell or repackage any of them: it reads the public registries, runs what it can, and says which is which. Every hosted endpoint here was sent an unauthenticated <span class="mono">initialize</span> on ${reachability.checked || "the build date"}, and each card says what came back rather than what its entry claims. You configure one once in the plugin library, then hand it to a single agent with the <span class="mono">+</span> in that agent's header. Two gates, on purpose.</p>

  <section class="stats">
    <div class="stat"><b>${plugins.length}</b><span>plugins in the library</span></div>
    <div class="stat"><b class="amber"><a href="/plugins/skills.html">${skillCount}</a></b><span>skills they ship</span></div>
    <div class="stat"><b>${categories.length}</b><span>categories</span></div>
    <div class="stat"><b>0</b><span>accounts, payments or ratings</span></div>
  </section>

  <div class="plg-tools">
    <input class="plg-search" type="search" placeholder="Search plugins, categories, skills…" aria-label="Search plugins">
    <div class="plg-filters">
${filters}
      <button class="plg-filter" data-ready-only>usable with no account</button>
    </div>
  </div>
  <p class="plg-count" data-count>${plugins.length} plugins</p>

${groups}

  <p class="plg-empty" data-empty hidden>Nothing matches that. Try a shorter word.</p>

  <div class="plg-note" style="margin-top:34px;">
    Missing one? Every plugin here is an MCP server, so anything that speaks the
    protocol works whether it is listed or not: point xNAUT at its command or its
    URL. To get one added, open an issue or a pull request on
    <a href="https://github.com/48Nauts-Operator/xNaut/issues">GitHub</a>.
  </div>
</main>

${footer}

<script src="/js/main.js"></script>
<script>
  (function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.plg'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('[data-group]'));
    var count = document.querySelector('[data-count]');
    var empty = document.querySelector('[data-empty]');
    var search = document.querySelector('.plg-search');
    var filters = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
    var readyOnly = document.querySelector('[data-ready-only]');
    var category = 'All';
    var readyFilter = false;

    function apply() {
      var term = search.value.trim().toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var ok = (category === 'All' || card.dataset.category === category)
          && (!readyFilter || card.dataset.ready === '1')
          && (!term || card.dataset.search.indexOf(term) !== -1);
        card.hidden = !ok;
        if (ok) shown += 1;
      });
      // A category heading with nothing under it reads as an empty category
      // rather than as a filtered one.
      groups.forEach(function (group) {
        group.hidden = !group.querySelector('.plg:not([hidden])');
      });
      count.textContent = shown + (shown === 1 ? ' plugin' : ' plugins');
      empty.hidden = shown !== 0;
    }

    search.addEventListener('input', apply);
    filters.forEach(function (button) {
      button.addEventListener('click', function () {
        filters.forEach(function (other) { other.classList.remove('on'); });
        button.classList.add('on');
        category = button.dataset.filter;
        apply();
        // Deep-linkable, so a link can point at one category.
        history.replaceState(null, '', category === 'All' ? '/plugins/' : '#' + category.toLowerCase().replace(/[^a-z]+/g, '-'));
      });
    });
    readyOnly.addEventListener('click', function () {
      readyFilter = !readyFilter;
      readyOnly.classList.toggle('on', readyFilter);
      apply();
    });

    var wanted = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    if (wanted) {
      var match = filters.find(function (button) {
        return button.dataset.filter.toLowerCase().replace(/[^a-z]+/g, '-') === wanted;
      });
      if (match) match.click();
    }
  })();
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "xNAUT Plugins",
  "description": ${JSON.stringify(indexDescription)},
  "url": "https://xnaut.dev/plugins/",
  "mainEntity": {
    "@type": "ItemList",
    "numberOfItems": ${plugins.length},
    "itemListElement": [
${plugins.map((plugin, index) => `      { "@type": "ListItem", "position": ${index + 1}, "url": "https://xnaut.dev/plugins/${plugin.id}.html", "name": ${JSON.stringify(plugin.name)} }`).join(",\n")}
    ]
  }
}
</script>
</body>
</html>
`;

// ---------------------------------------------------------------- detail

const detailPage = (plugin) => {
  const state = blocker(plugin);
  const measured = reach(plugin);
  const line = connector(plugin);
  const skills = plugin.skills || [];
  const related = plugins
    .filter((other) => other.category === plugin.category && other.id !== plugin.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
  const description = `${plugin.description} An MCP server your xNAUT agents can use${skills.length ? `, shipping ${skills.length} skill${skills.length === 1 ? "" : "s"}` : ""}.`;

  return `<!doctype html>
<html lang="en">
${head({
    title: `${plugin.name} — MCP plugin for xNAUT`,
    description,
    canonical: `https://xnaut.dev/plugins/${plugin.id}.html`,
    extraStyle: `${DETAIL_STYLE}\n`,
  })}
<body>

${nav}

<main class="legal">
  <p class="plg-state"><a href="/plugins/">Plugins</a> / ${esc(plugin.category)}</p>
  <div class="plg-hero">${tile(plugin, "plg-mark big")}<h1>${esc(plugin.name)}</h1></div>
  <p class="plg-lead">${esc(plugin.description)}</p>

  <div class="plg-actions">
    <span class="plg-cat">${esc(plugin.category)}</span>
    <span class="plg-state${measured === "answered with no account" ? " ready" : ""}">${esc(measured || state || "no credential declared")}</span>
    <button class="plg-copy" data-copy="${esc(plugin.id)}">copy id: ${esc(plugin.id)}</button>
    ${plugin.docs_url ? `<a class="plg-state" href="${esc(plugin.docs_url)}" rel="noopener noreferrer" target="_blank">source ↗</a>` : '<span class="plg-state">no source link</span>'}
  </div>

  ${line ? `<section class="plg-sec">
    <h2>Connector</h2>
    <div class="plg-conn"><code>${esc(line)}</code><button class="plg-copy" data-copy="${esc(line)}">copy</button></div>
    <p style="margin-top:10px;">${plugin.transport === "http"
      ? "An HTTP MCP endpoint. xNAUT talks to it directly; nothing is installed."
      : "Started by xNAUT when an agent that holds this plugin runs. Nothing is installed globally."}</p>
  </section>` : ""}

  ${measured ? `<section class="plg-sec">
    <h2>What we measured</h2>
    <p><b>${esc(measured)}.</b> On ${esc(reachability.checked)} we sent this endpoint an MCP <span class="mono">initialize</span> with no credentials and no headers, and that is what came back.</p>
    <p class="plg-state">Not a security audit, not an endorsement, and not a heartbeat: it is one request on one date. An endpoint is a vendor's service, not an artifact we can pin, so it can behave differently tomorrow.</p>
  </section>` : ""}

  <section class="plg-sec">
    <h2>Credentials</h2>
    ${(plugin.required_env || []).length
      ? `<ul class="plg-env">${plugin.required_env.map((name) => `<li><b>${esc(name)}</b><span>required — you paste it once, into your own machine's plugin library</span></li>`).join("")}</ul>`
      : "<p>None. It runs as soon as it is switched on.</p>"}
    ${plugin.note ? `<div class="plg-note">${esc(plugin.note)}</div>` : ""}
  </section>

  <section class="plg-sec">
    <h2>Skills it ships</h2>
    ${skills.length
      ? `<p>${skills.length} skill${skills.length === 1 ? "" : "s"}. The connector gives an agent the tools; a skill tells it when to reach for them.</p>
    <ul class="plg-skills">${skills.map((skill) => `<li>${esc(skill)}</li>`).join("")}</ul>`
      : "<p>None. The connector gives an agent the tools; a skill would tell it when to reach for them.</p>"}
  </section>

  <section class="plg-sec">
    <h2>How it reaches your agent</h2>
    <ol class="plg-steps">
      <li>The library holds it, with your credential, on your machine.</li>
      <li>You hand it to one agent with the <span class="mono">+</span> in that agent's header. No other agent gets it.</li>
    </ol>
    <p>Two gates, on purpose. A chat turn never uses a plugin; a build run gets the ones that agent holds.</p>
  </section>

  <section class="plg-sec">
    <h2>Provenance</h2>
    <p>${plugin.seeded === false ? "Added in this xNAUT install." : plugin.note
      ? "Entry compiled from the public plugin registries, then run and described by 48Nauts — the setup note above is ours, and it exists because someone ran this and watched what it did."
      : "Entry compiled from the public plugin registries. The description is the registry's own; we have not independently run this one."}</p>
    <p class="plg-state">No stars, no download counts, no verification badge: we do not have those numbers and we are not going to invent them.</p>
  </section>

  ${related.length ? `<section class="plg-sec">
    <h2>Also in ${esc(plugin.category)}</h2>
    <div class="plg-related">${related.map((other) => `<a href="/plugins/${esc(other.id)}.html">${esc(other.name)}</a>`).join("")}</div>
  </section>` : ""}
</main>

${footer}

<script src="/js/main.js"></script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": ${JSON.stringify(plugin.name)},
  "applicationCategory": "DeveloperApplication",
  "description": ${JSON.stringify(plugin.description)},
  "url": "https://xnaut.dev/plugins/${plugin.id}.html",
  "operatingSystem": "macOS, Windows",
  "isAccessibleForFree": true${plugin.docs_url ? `,\n  "sameAs": ${JSON.stringify(plugin.docs_url)}` : ""}
}
</script>
</body>
</html>
`;
};

// ---------------------------------------------------------------- skills

// Every skill, named, on one page. A skill name is the most specific thing in
// this whole catalogue — nobody searches "MCP server for design", they search
// "figma token extraction" — so the names are the long tail, and a count on a
// card is worth nothing to anyone looking for one.
const skillRows = plugins
  .flatMap((plugin) => (plugin.skills || []).map((skill) => ({ skill, plugin })))
  .sort((a, b) => a.skill.localeCompare(b.skill));

const skillsDescription = `Every skill the ${plugins.length} plugins in xNAUT's library ship: ${skillRows.length} of them, with the plugin each one comes from.`;

const skillsPage = `<!doctype html>
<html lang="en">
${head({
  title: "Plugin skills | xNAUT",
  description: skillsDescription,
  canonical: "https://xnaut.dev/plugins/skills.html",
  extraStyle: `${SHARED_STYLE}
  <style>
    main.legal.plg-page { max-width: 1240px; }
    .plg-search { width: 100%; max-width: 420px; padding: 10px 14px; border: 1px solid var(--border-card);
                  border-radius: 10px; background: var(--panel-deep); color: var(--text);
                  font-family: var(--sans); font-size: 14px; margin: 26px 0 0; }
    .plg-search:focus { outline: none; border-color: #3A3E46; }
    .plg-count { font-family: var(--mono); font-size: 12.5px; color: var(--faint); margin: 14px 0 18px; }
    .sk { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0 26px; margin: 0; padding: 0; list-style: none; }
    .sk li { display: flex; gap: 12px; align-items: baseline; padding: 8px 0;
             border-bottom: 1px solid var(--border-card); }
    .sk li[hidden] { display: none; }
    .sk code { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
               font-family: var(--mono); font-size: 12.5px; color: var(--text-soft); }
    .sk a { flex: 0 0 auto; font-size: 12.5px; color: var(--amber); text-decoration: none; }
    .sk a:hover { text-decoration: underline; }
  </style>
`,
})}
<body>

${nav}

<main class="legal plg-page">
  <p class="plg-state"><a href="/plugins/">Plugins</a> / Skills</p>
  <h1>Plugin skills</h1>
  <span class="updated">${skillRows.length} skills, from ${plugins.filter((p) => (p.skills || []).length).length} of the ${plugins.length} plugins</span>

  <p class="plg-lead">A plugin gives an agent tools. A skill tells it when to reach for them, and what good use looks like. These ship with the plugins themselves; xNAUT does not write them.</p>

  <input class="plg-search" type="search" placeholder="Search skills…" aria-label="Search skills">
  <p class="plg-count" data-count>${skillRows.length} skills</p>

  <ul class="sk">
${skillRows.map(({ skill, plugin }) => `    <li data-search="${esc(`${skill} ${plugin.name}`.toLowerCase())}"><code>${esc(skill)}</code><a href="/plugins/${esc(plugin.id)}.html">${esc(plugin.name)}</a></li>`).join("\n")}
  </ul>
  <p class="plg-empty" data-empty hidden style="color:var(--faint);font-size:14px;">Nothing matches that.</p>
</main>

${footer}

<script>
  (function () {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.sk li'));
    var count = document.querySelector('[data-count]');
    var empty = document.querySelector('[data-empty]');
    document.querySelector('.plg-search').addEventListener('input', function (event) {
      var term = event.target.value.trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (row) {
        var ok = !term || row.dataset.search.indexOf(term) !== -1;
        row.hidden = !ok;
        if (ok) shown += 1;
      });
      count.textContent = shown + (shown === 1 ? ' skill' : ' skills');
      empty.hidden = shown !== 0;
    });
  })();
</script>
</body>
</html>
`;

// ---------------------------------------------------------------- write

const dir = new URL("../plugins/", import.meta.url);
mkdirSync(dir, { recursive: true });
// Drop pages for plugins that left the catalogue, so a removed entry cannot
// linger as an orphan URL in the sitemap.
for (const file of readdirSync(dir)) {
  if (file.endsWith(".html")) rmSync(new URL(file, dir));
}

// Every page must carry the site stylesheet and the working filter rule: a page
// that stops linking /css/style.css is how "one new page" becomes a redesign,
// and display:flex silently beat [hidden] the first time this shipped.
for (const required of ['href="/css/style.css?v=4"', ".plg[hidden] { display: none; }"]) {
  if (!indexPage.includes(required)) throw new Error(`the index is missing: ${required}`);
}
writeFileSync(new URL("index.html", dir), indexPage);
writeFileSync(new URL("catalog.json", dir), `${JSON.stringify(plugins, null, 2)}\n`);
writeFileSync(new URL("skills.html", dir), skillsPage);

for (const plugin of plugins) {
  const page = detailPage(plugin);
  if (!page.includes('href="/css/style.css?v=4"')) throw new Error(`${plugin.id} is missing the stylesheet`);
  if (PRIVATE_HOST.test(page)) throw new Error(`${plugin.id} would publish a private host`);
  writeFileSync(new URL(`${plugin.id}.html`, dir), page);
}
if (PRIVATE_HOST.test(indexPage)) throw new Error("the index would publish a private host");

// The sitemap: the long tail is the point, so every plugin gets its own entry.
const sitemapPath = new URL("../sitemap.xml", import.meta.url);
let sitemap = readFileSync(sitemapPath, "utf8");
sitemap = sitemap.replace(/ *<url>\s*<loc>https:\/\/xnaut\.dev\/plugins[^<]*<\/loc>[\s\S]*?<\/url>\n/g, "");
const today = new Date().toISOString().slice(0, 10);
const entries = [
  `  <url>\n    <loc>https://xnaut.dev/plugins/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`,
  `  <url>\n    <loc>https://xnaut.dev/plugins/skills.html</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`,
  ...plugins.map((plugin) => `  <url>\n    <loc>https://xnaut.dev/plugins/${plugin.id}.html</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`),
].join("");
writeFileSync(sitemapPath, sitemap.replace("</urlset>", `${entries}</urlset>`));

console.log(`wrote plugins/index.html + skills.html + ${plugins.length} pages — ${readyCount} need no credential, ${skillCount} skills, ${categories.length} categories`);
