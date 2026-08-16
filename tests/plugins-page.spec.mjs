// Drives /plugins/ in a real browser: the site's own chrome and colours, the
// filter and search JS the index carries inline, and a detail page.
//
// Serve the site and run it:
//
//   python3 -m http.server 8899
//   npx playwright test tests/plugins-page.spec.mjs
import { test, expect } from '@playwright/test';

const SITE = 'http://127.0.0.1:8899';

// Read over HTTP rather than from disk, so the spec runs from wherever it is
// invoked and checks the file the site actually serves.
let catalog = null;
let reach = null;
test.beforeEach(async ({ request }) => {
  if (!catalog) catalog = await (await request.get(`${SITE}/plugins/catalog.json`)).json();
  if (!reach) reach = await (await request.get(`${SITE}/plugins/reachability.json`)).json();
});

test('the index uses the site design, groups by category and filters', async ({ page }) => {
  // js/main.js fetches release counts from the unauthenticated GitHub API,
  // which is capped at 60 requests an hour per IP, so a run of these tests can
  // exhaust it and log a 403. main.js already removes the stat rather than
  // showing a stale number, so that is the page working, not failing.
  // The console text for a failed request is just "Failed to load resource:
  // …403", with the URL only in the message's location, so both are checked.
  const errors = [];
  const fromGitHub = (message) => `${message.text()} ${message.location()?.url || ''}`.includes('api.github.com');
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !fromGitHub(m)) errors.push(m.text()); });
  await page.goto(`${SITE}/plugins/`);

  // The site's own chrome, not a new one.
  await expect(page.locator('nav.nav .logo-name')).toHaveText('xNAUT');
  await expect(page.locator('footer.footer')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(10, 11, 13)');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily))
    .toContain('Space Grotesk');

  await expect(page.locator('.plg')).toHaveCount(catalog.length);
  await expect(page.locator('[data-count]')).toHaveText(`${catalog.length} plugins`);

  // Category sections, and filtering hides both the cards and the now-empty
  // headings.
  const design = catalog.filter((p) => p.category === 'Design').length;
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.locator('.plg:visible')).toHaveCount(design);
  await expect(page.locator('[data-group]:visible')).toHaveCount(1);

  // A MEASUREMENT outranks a declaration. A hosted endpoint counts as usable
  // only if it actually answered without an account; a local one falls back to
  // what it declares, because running it to find out would mean executing a
  // stranger's code on this machine.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'usable with no account' }).click();
  const ready = catalog.filter((p) => {
    const measured = reach.results[p.id];
    if (measured) return measured === 'open';
    return !((p.transport === 'http' && !p.url) || (p.transport === 'stdio' && !p.command) || (p.required_env || []).length);
  }).length;
  await expect(page.locator('.plg:visible')).toHaveCount(ready);

  await page.getByRole('button', { name: 'usable with no account' }).click();
  await page.locator('.plg-search').fill('zzzznope');
  await expect(page.locator('.plg:visible')).toHaveCount(0);
  await expect(page.locator('[data-empty]')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a card opens the plugin its own page, with skills and the connector', async ({ page }) => {
  await page.goto(`${SITE}/plugins/`);
  await page.locator('.plg-search').fill('context7');
  await page.locator('.plg:visible').first().click();

  await expect(page).toHaveURL(`${SITE}/plugins/context7.html`);
  await expect(page.locator('h1')).toHaveText('Context7');
  // The connector is the most useful fact on the page, and it is the app's.
  await expect(page.locator('.plg-conn code').first()).toContainText('@upstash/context7-mcp');
  await expect(page.getByRole('heading', { name: 'Skills it ships' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible();
  // "source", not "docs": it points at the repository.
  await expect(page.getByRole('link', { name: /source/ })).toHaveAttribute('href', /github\.com|upstash/);
  // Back to the catalogue.
  await page.getByRole('link', { name: '← All plugins' }).click();
  await expect(page).toHaveURL(`${SITE}/plugins/`);
});

test('a plugin with skills lists every one of them', async ({ page }) => {
  // The skills are the long tail this page exists for; a page that renders the
  // count but not the names is worth nothing to a search engine.
  const richest = catalog.slice().sort((a, b) => (b.skills || []).length - (a.skills || []).length)[0];
  expect((richest.skills || []).length).toBeGreaterThan(5);
  await page.goto(`${SITE}/plugins/${richest.id}.html`);
  await expect(page.locator('.plg-skills li')).toHaveCount(richest.skills.length);
  for (const skill of richest.skills.slice(0, 5)) {
    await expect(page.locator('.plg-skills li', { hasText: skill })).toBeVisible();
  }
});

test('every generated page is reachable and carries its own canonical', async ({ request }) => {
  // Every plugin has a page: checked for all of them, cheaply, with HEAD-ish
  // GETs. A card linking to a 404 is the failure this catches.
  const missing = [];
  for (const plugin of catalog) {
    const response = await request.get(`${SITE}/plugins/${plugin.id}.html`);
    if (response.status() !== 200) missing.push(plugin.id);
  }
  expect(missing).toEqual([]);

  for (const plugin of [catalog[0], catalog[Math.floor(catalog.length / 2)], catalog.at(-1)]) {
    const response = await request.get(`${SITE}/plugins/${plugin.id}.html`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<link rel="canonical" href="https://xnaut.dev/plugins/${plugin.id}.html">`);
    expect(html).toContain('"@type": "SoftwareApplication"');
  }

  // The sitemap carries the long tail, which is the point of the directory.
  const sitemap = await (await request.get(`${SITE}/sitemap.xml`)).text();
  expect(sitemap).toContain('https://xnaut.dev/plugins/');
  for (const plugin of [catalog[3], catalog.at(-2)]) {
    expect(sitemap).toContain(`https://xnaut.dev/plugins/${plugin.id}.html`);
  }
});

test('nothing private reaches the published files', async ({ request }) => {
  // The export this is built from carries a Tailscale hostname in its env
  // defaults, and Pages serves the whole repository.
  const suspect = /(\.ts\.net|tail[0-9a-f]{6,}|GITEA_HOST\s*=)/i;
  for (const path of ['/plugins/', '/plugins/forgejo.html', '/plugins/catalog.json']) {
    const body = await (await request.get(SITE + path)).text();
    expect(body).not.toMatch(suspect);
  }
});

test('the home page links the plugins directory', async ({ page }) => {
  await page.goto(`${SITE}/`);
  await page.locator('nav.nav').getByRole('link', { name: 'Plugins', exact: true }).click();
  await expect(page).toHaveURL(`${SITE}/plugins/`);
  await expect(page.locator('h1')).toHaveText('Plugins');
});

test('the stats band only claims what can be counted', async ({ page }) => {
  // "116 need no credential" was on this band and was not a fact: it counted
  // entries that DECLARE no credential, which is not the same as having been
  // run without an account, and nothing here has been run.
  await page.goto(`${SITE}/plugins/`);
  const stats = page.locator('.stats');
  await expect(stats).toContainText(`${catalog.length}`);
  await expect(stats).toContainText('plugins in the library');
  await expect(stats).not.toContainText('need no credential');
  await expect(stats).not.toContainText('verified');

  const skills = catalog.reduce((total, p) => total + (p.skills || []).length, 0);
  await expect(stats.getByRole('link', { name: String(skills) })).toBeVisible();
});

test('every skill is named on the skills page, and links to its plugin', async ({ page }) => {
  // The names are the long tail: nobody searches "MCP server for design", they
  // search "figma token extraction".
  const skills = catalog.flatMap((p) => (p.skills || []).map((skill) => ({ skill, id: p.id })));
  await page.goto(`${SITE}/plugins/skills.html`);
  await expect(page.locator('.sk li')).toHaveCount(skills.length);
  await expect(page.locator('[data-count]')).toHaveText(`${skills.length} skills`);

  const sample = skills[Math.floor(skills.length / 2)];
  await page.locator('.plg-search').fill(sample.skill);
  await expect(page.locator('.sk li:visible').first()).toContainText(sample.skill);
  await page.locator('.sk li:visible').first().getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/plugins/${sample.id}\\.html$`));
});

test('a hosted endpoint states what it answered, not what it claims', async ({ page }) => {
  // 82 of the 95 hosted entries DECLARE no credential. Probed unauthenticated
  // on 2026-08-16, 80 answered 401 or 403. The card must carry the measurement.
  const refusing = Object.entries(reach.results).filter(([, state]) => state === 'auth');
  const open = Object.entries(reach.results).filter(([, state]) => state === 'open');
  expect(refusing.length).toBeGreaterThan(50);
  expect(open.length).toBeGreaterThan(0);

  await page.goto(`${SITE}/plugins/${refusing[0][0]}.html`);
  await expect(page.getByRole('heading', { name: 'What we measured' })).toBeVisible();
  await expect(page.locator('main')).toContainText('sign-in required');
  await expect(page.locator('main')).toContainText(reach.checked);
  // It must not read as a verdict on the vendor.
  await expect(page.locator('main')).toContainText('Not a security audit');

  await page.goto(`${SITE}/plugins/${open[0][0]}.html`);
  await expect(page.locator('main')).toContainText('answered with no account');
});
