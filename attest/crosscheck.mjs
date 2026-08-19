#!/usr/bin/env node
// The chain is computed twice: by the MCP that writes receipts (Python) and by
// this page that checks them (JS). If the two canonical forms ever drift, the
// page reports a broken chain for a log that is fine, and the only way to tell
// which side is wrong is to have compared them. So: compare them.
//
//   node attest/crosscheck.mjs [path/to/securosys-attest.py]
//
// The JS half is lifted out of index.html itself rather than copied here. A
// copy would keep passing after the page changed.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PY = process.argv[2] || join(process.env.HOME,
  'DevHub_Studio/factory/02-Development/xnaut/.worktrees/nautflow-incident-loop/mcp/securosys-attest.py');

const page = readFileSync(join(here, 'index.html'), 'utf8');
const fields = /const LINK_FIELDS = (\[[^\]]*\]);/.exec(page);
const fn = /const linkHash = (async \(r\) => \{[\s\S]*?\n  \};)/.exec(page);
if (!fields || !fn) throw new Error('could not lift LINK_FIELDS/linkHash out of index.html');

const linkHash = new Function('crypto', 'TextEncoder', `
  const LINK_FIELDS = ${fields[1]};
  const enc = new TextEncoder();
  const linkHash = ${fn[1].replace(/;$/, '')};
  return linkHash;
`)(webcrypto, TextEncoder);

// Awkward on purpose: non-ASCII (ensure_ascii), a key order nothing sorted, an
// integer seq, and local-only fields that must not reach the hash.
const receipts = [
  { seq: 0, prev: '0'.repeat(64), ts: '2026-08-20T00:00:00+00:00', subject: 'xnaut.release',
    digest: 'a'.repeat(64), key_name: 'XNAUT_ATTEST_KEY', algorithm: 'SHA256_WITH_RSA', signature: 'c2ln' },
  { signature: 'c2ln2', algorithm: 'SHA256_WITH_RSA', key_name: 'K', digest: 'b'.repeat(64),
    subject: 'Grüße/日本語', ts: '2026-08-20T00:01:00+00:00', prev: 'f'.repeat(64), seq: 1,
    tsb_url: 'https://tsb.example', meta: { ticket: 'XNAUT-211' } },
];

const pyOut = execFileSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("attest", ${JSON.stringify(PY)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps([m.link_hash(r) for r in json.loads(sys.argv[1])]))
`, JSON.stringify(receipts)], { encoding: 'utf8' });

const py = JSON.parse(pyOut);
let bad = 0;
for (let i = 0; i < receipts.length; i++) {
  const js = await linkHash(receipts[i]);
  if (js !== py[i]) { bad++; console.error(`receipt ${i}\n  python ${py[i]}\n  js     ${js}`); }
}
if (bad) { console.error(`${bad} link hash(es) disagree`); process.exit(1); }
console.log(`link hashes agree across both implementations (${receipts.length} receipts)`);
