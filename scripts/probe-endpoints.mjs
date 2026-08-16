// Probes every hosted endpoint in plugins/catalog.json and writes
// plugins/reachability.json, which the page renders instead of the entry's
// own claim.
//
//   node scripts/probe-endpoints.mjs
//
// One unauthenticated MCP `initialize` per endpoint. No credentials are ever
// sent: the question is what a stranger gets, which is exactly what a reader of
// the page is about to be.
//
// Why this exists: 82 of the 95 hosted entries DECLARE no credential, so the
// library reads them as ready. Probed on 2026-08-16, most answered 401 or 403.
// A declaration is not a measurement.
//
// It sends xNAUT's own User-Agent, and that detail is load-bearing. The first
// version of this probe was written in Python, whose urllib announces itself as
// `Python-urllib/3.9`, and Cloudflare answers THAT with a bare 403 and no
// WWW-Authenticate. 34 endpoints were recorded as refusing outright when they
// were only refusing a scraper. Measured on mcp.sentry.dev: no User-Agent gives
// 401 with an OAuth challenge, `Python-urllib/3.9` gives 403, xNAUT's gives 401.
// A measurement tool that changes the answer is worse than no measurement.
//
// Local (stdio) plugins are deliberately NOT probed. Finding out whether
// `npx -y some-package` works means running a stranger's code on this machine,
// which is the thing the whole posture avoids.
import { readFileSync, writeFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../plugins/catalog.json', import.meta.url), 'utf8'));
const body = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'xnaut-survey', version: '1' } },
});

const probe = async (plugin) => {
  // ${JFROG_URL}/mcp and friends: the entry has no endpoint until its owner
  // supplies one, so there is nothing to ask.
  if (!/^https?:\/\//.test(plugin.url || '')) return 'needs-its-url';
  try {
    const response = await fetch(plugin.url, {
      method: 'POST', body,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': 'xNAUT/1.16.2 (+https://xnaut.dev)',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) return 'auth';
    if (!response.ok) return `http-${response.status}`;
    return (await response.text()).includes('"result"') ? 'open' : 'answered';
  } catch {
    return 'unreachable';
  }
};

const hosted = catalog.filter((plugin) => plugin.transport === 'http');
const results = {};
for (let i = 0; i < hosted.length; i += 8) {
  const batch = hosted.slice(i, i + 8);
  const states = await Promise.all(batch.map(probe));
  batch.forEach((plugin, index) => { results[plugin.id] = states[index]; });
}

const counts = Object.values(results).reduce((all, state) => ({ ...all, [state]: (all[state] || 0) + 1 }), {});
writeFileSync(new URL('../plugins/reachability.json', import.meta.url),
  `${JSON.stringify({
    checked: new Date().toISOString().slice(0, 10),
    method: 'unauthenticated MCP initialize, HTTP POST, no credentials sent',
    results,
  }, null, 1)}\n`);
console.log(`probed ${hosted.length} hosted endpoints:`, counts);
