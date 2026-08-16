// Probes every hosted endpoint in plugins/catalog.json and writes
// plugins/reachability.json, which the page renders instead of the entry's
// own claim.
//
//   node scripts/probe-endpoints.mjs
//
// One unauthenticated MCP `initialize` per endpoint. NO credentials and no
// headers are sent, ever: the question is what a stranger gets, which is
// exactly what a reader of the page is about to be.
//
// Why this exists: 82 of the 95 hosted entries DECLARE no credential, so the
// library reads them as ready. Probed on 2026-08-16, 80 answered 401 or 403.
// A declaration is not a measurement.
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
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
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
