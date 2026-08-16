// Generates plugins.html from data/plugins.json.
//
// The data is the app's own library — hand-written seeds first, then the
// compiled catalogue, deduplicated by id — exported from the xNAUT repo:
//
//   cargo test --bin xnaut plugins::tests::export_public_catalogue -- --ignored --nocapture
//
// Drop that output over data/plugins.json and run `node scripts/build-plugins-page.mjs`.
// Generating from src-tauri/assets/plugin-catalog.json alone silently dropped
// the 18 servers that exist only in the seed, Forgejo and Filesystem among them.
//
// The page is baked rather than fetched at runtime: this site is static HTML on
// GitHub Pages, every other page is crawlable, and a list nobody can index is a
// list nobody finds.
//
// The export carries fields that must never be published — `env` holds default
// values, and one of them is a private Tailscale hostname. Pages serves this
// whole repository, so data/plugins.json is a public URL. The build projects
// every entry down to the fields the page uses and REWRITES the data file with
// the projection, so a raw export dropped in here is stripped on the next
// build rather than published.
import { readFileSync, writeFileSync } from "node:fs";

const PUBLIC_FIELDS = ["id", "name", "description", "category", "skills", "docs_url"];
const dataPath = new URL("../data/plugins.json", import.meta.url);
const raw = JSON.parse(readFileSync(dataPath, "utf8"));
const plugins = raw.map((plugin) => Object.fromEntries(
  PUBLIC_FIELDS.filter((field) => plugin[field] !== undefined && plugin[field] !== "")
    .map((field) => [field, plugin[field]]),
));
writeFileSync(dataPath, `${JSON.stringify(plugins, null, 2)}\n`);

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

// Order the categories the way someone scanning for their own tool would: the
// ones with the most in them first, Other last.
const CATEGORY_ORDER = ["Dev", "Business", "Docs & search", "Comms", "Work tracking", "Knowledge", "Design", "Other"];
const byCategory = (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
const categories = [...new Set(plugins.map((p) => p.category))].sort(byCategory);

// A monogram tile, coloured deterministically from the id. No brand logos here:
// the app has marks for 13 of these 130, and a grid where a tenth of the rows
// are special looks like a bug rather than a design.
const tile = (plugin) => {
  let hash = 0;
  for (let i = 0; i < plugin.id.length; i += 1) hash = (hash * 31 + plugin.id.charCodeAt(i)) % 360;
  const letter = esc(plugin.name.trim().charAt(0).toUpperCase() || "?");
  return `<span class="plg-mark" style="background:hsl(${hash} 38% 26%);color:hsl(${hash} 70% 74%)">${letter}</span>`;
};

const card = (plugin) => {
  const skills = (plugin.skills || []).length;
  const haystack = `${plugin.name} ${plugin.description} ${plugin.category} ${(plugin.skills || []).join(" ")}`;
  return `    <article class="plg" data-category="${esc(plugin.category)}" data-search="${esc(haystack.toLowerCase())}">
      <div class="plg-head">${tile(plugin)}<h3>${esc(plugin.name)}</h3></div>
      <p>${esc(plugin.description)}</p>
      <div class="plg-foot">
        <span class="plg-cat">${esc(plugin.category)}</span>
        ${skills ? `<span>${skills} skill${skills === 1 ? "" : "s"}</span>` : ""}
        ${plugin.docs_url ? `<a href="${esc(plugin.docs_url)}" rel="noopener noreferrer" target="_blank">Docs&nbsp;→</a>` : ""}
      </div>
    </article>`;
};

const filters = ["All", ...categories]
  .map((name, index) => `      <button class="plg-filter${index === 0 ? " on" : ""}" data-filter="${esc(name)}">${esc(name)}</button>`)
  .join("\n");

const cards = plugins
  .slice()
  .sort((a, b) => byCategory(a.category, b.category) || a.name.localeCompare(b.name))
  .map(card)
  .join("\n");

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plugins | xNAUT</title>
  <meta name="description" content="${plugins.length} MCP servers your agents can use inside xNAUT: repositories, docs, databases, browsers, payments and messaging. Configured once, handed to an agent.">
  <link rel="canonical" href="https://xnaut.dev/plugins.html">
  <meta name="author" content="André">
  <meta name="keywords" content="xNAUT plugins, MCP servers, agent tools, model context protocol, coding agent integrations">
  <meta property="og:title" content="xNAUT Plugins">
  <meta property="og:description" content="${plugins.length} MCP servers your agents can use. Configured once, handed to an agent.">
  <meta property="og:image" content="https://xnaut.dev/assets/og-v2.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=4">
  <style>
    .plg-lead { font-size: 17px; line-height: 1.55; color: var(--text-soft); margin: 22px 0 0; }
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
    .plg-count { font-family: var(--mono); font-size: 12.5px; color: var(--faint); margin: 16px 0 20px; }
    .plg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .plg { display: flex; flex-direction: column; gap: 10px; padding: 20px; background: var(--panel);
           border: 1px solid var(--border-card); border-radius: 14px; }
    /* display:flex beats the hidden attribute, so filtering would show every
       card while claiming to have hidden them. */
    .plg[hidden] { display: none; }
    .plg-head { display: flex; align-items: center; gap: 11px; }
    .plg-head h3 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
    .plg-mark { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px;
                border-radius: 9px; font-family: var(--mono); font-size: 13px; font-weight: 700; }
    .plg p { flex: 1 1 auto; font-size: 14px; line-height: 1.55; color: var(--muted); margin: 0; }
    .plg-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
    .plg-cat { padding: 3px 8px; border: 1px solid var(--border-card); border-radius: 6px; }
    .plg-foot a { color: var(--amber); text-decoration: none; margin-left: auto; }
    .plg-foot a:hover { text-decoration: underline; }
    .plg-empty { padding: 34px 0; color: var(--faint); font-size: 14px; }
    .plg-note { border-left: 2px solid var(--amber); background: var(--panel); padding: 16px 20px;
                border-radius: 0 10px 10px 0; margin: 30px 0 0; font-size: 15px; color: var(--text-soft);
                line-height: 1.65; }
    @media (max-width: 900px) { .plg-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 620px) { .plg-grid { grid-template-columns: 1fr; } }
  </style>
  <script defer src="https://wave.21nauts.com/script.js" data-website-id="6bb927bb-b2fd-486f-924c-df55c043bcad"></script>
</head>
<body>

<nav class="nav">
  <a class="logo" href="/">
    <span class="logo-mark">xN</span>
    <span class="logo-name">xNAUT</span>
  </a>
  <div class="nav-actions">
    <a href="/">← xnaut.dev</a>
    <a class="btn btn-primary btn-sm" href="https://github.com/48Nauts-Operator/xNaut/releases/latest">Download latest</a>
  </div>
</nav>

<main class="legal">
  <h1>Plugins</h1>
  <span class="updated">${plugins.length} MCP servers your agents can use · configured once, handed to an agent</span>

  <p class="plg-lead">A plugin is an MCP server. You configure it once in xNAUT's plugin library, then hand it to whichever agent needs it with the <span class="mono">+</span> in that agent's header. The agent gets that server's tools for its run.</p>

  <div class="plg-tools">
    <input class="plg-search" type="search" placeholder="Search plugins, categories, skills…" aria-label="Search plugins">
    <div class="plg-filters">
${filters}
    </div>
  </div>
  <p class="plg-count" data-count>${plugins.length} plugins</p>

  <div class="plg-grid" data-grid>
${cards}
  </div>
  <p class="plg-empty" data-empty hidden>Nothing matches that. Try a shorter word.</p>

  <div class="plg-note">
    Missing one? Every plugin here is an MCP server, so anything that speaks the
    protocol works whether it is listed or not: point xNAUT at its command or its
    URL. To get one added to this catalogue, open an issue on
    <a href="https://github.com/48Nauts-Operator/xNaut/issues">GitHub</a>.
  </div>
</main>

<footer class="footer">
  <div class="logo">
    <span class="logo-mark sm">xN</span>
    <span class="fine">© 2026 48Nauts · MIT License</span>
  </div>
  <div class="footer-links">
    <a href="/blog/">Blog</a>
    <a href="/plugins.html">Plugins</a>
    <a href="/releases.html">Releases</a>
    <a href="/loom.html">Loom</a>
    <a href="https://docs.xnaut.dev/docs">Docs</a>
    <a href="/">xnaut.dev</a>
  </div>
</footer>

<script>
  (function () {
    var grid = document.querySelector('[data-grid]');
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.plg'));
    var count = document.querySelector('[data-count]');
    var empty = document.querySelector('[data-empty]');
    var search = document.querySelector('.plg-search');
    var filters = Array.prototype.slice.call(document.querySelectorAll('.plg-filter'));
    var category = 'All';

    function apply() {
      var term = search.value.trim().toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var ok = (category === 'All' || card.dataset.category === category)
          && (!term || card.dataset.search.indexOf(term) !== -1);
        card.hidden = !ok;
        if (ok) shown += 1;
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
      });
    });
  })();
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "xNAUT Plugins",
  "description": "${plugins.length} MCP servers xNAUT agents can use.",
  "url": "https://xnaut.dev/plugins.html"
}
</script>
</body>
</html>
`;

// The two things that have actually gone wrong here, checked on every build.
// `display:flex` beats the hidden attribute, so filtering hid nothing while
// reporting that it had; and a page that stops linking the site stylesheet is
// how a "new page" turns into a redesign.
for (const required of ['.plg[hidden] { display: none; }', 'href="/css/style.css?v=4"']) {
  if (!page.includes(required)) throw new Error(`generated page is missing: ${required}`);
}

writeFileSync(new URL("../plugins.html", import.meta.url), page);
console.log(`wrote plugins.html — ${plugins.length} plugins, ${categories.length} categories`);
