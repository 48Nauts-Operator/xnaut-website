// Drives plugins.html in a real browser: the site's own chrome and colours, and
// the filter/search JS that the generated page carries inline.
//
// Serve the site and run it:
//
//   python3 -m http.server 8899
//   npx playwright test tests/plugins-page.spec.mjs
//
import { test, expect } from '@playwright/test';

const URL = 'http://127.0.0.1:8899/plugins.html';

test('the plugins page uses the site design and filters', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  // The site's own chrome, not a new one.
  await expect(page.locator('nav.nav .logo-name')).toHaveText('xNAUT');
  await expect(page.locator('footer.footer')).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(10, 11, 13)'); // --bg from css/style.css
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily);
  expect(font).toContain('Space Grotesk');

  await expect(page.locator('.plg')).toHaveCount(148);
  await expect(page.locator('[data-count]')).toHaveText('148 plugins');

  // Category filter.
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.locator('.plg:visible')).toHaveCount(7);
  await expect(page.locator('[data-count]')).toHaveText('7 plugins');

  // Search runs across name, description and skills.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('.plg-search').fill('forgejo');
  // Two match: Forgejo itself, and GitHub whose description names it. Both are
  // right — the search reads the description, not just the title.
  await expect(page.locator('.plg:visible')).toHaveCount(2);
  await expect(page.locator('.plg:visible').first().locator('h3')).toHaveText('Forgejo');
  await page.locator('.plg-search').fill('zzzznope');
  await expect(page.locator('.plg:visible')).toHaveCount(0);
  await expect(page.locator('[data-empty]')).toBeVisible();

  expect(errors).toEqual([]);
});

test('the home page links the plugins page', async ({ page }) => {
  await page.goto('http://127.0.0.1:8899/');
  await page.locator('nav.nav').getByRole('link', { name: 'Plugins', exact: true }).click();
  await expect(page).toHaveURL(/plugins\.html$/);
  await expect(page.locator('h1')).toHaveText('Plugins');
});
