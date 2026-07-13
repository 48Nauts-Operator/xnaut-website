// Resolve latest release: version pill + direct download links.
// Falls back to the releases page (hrefs already in the HTML) on any failure.
(async () => {
  try {
    const repo = await fetch('https://api.github.com/repos/48Nauts-Operator/xNaut').then(r => r.ok && r.json());
    if (repo) {
      const n = repo.stargazers_count;
      const stars = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
      document.querySelectorAll('[data-stars]').forEach(el => { el.textContent = `★ ${stars}`; });
    }
  } catch { /* keep plain star glyph */ }

  try {
    const res = await fetch('https://api.github.com/repos/48Nauts-Operator/xNaut/releases/latest');
    if (!res.ok) return;
    const rel = await res.json();

    const version = rel.tag_name.replace(/^v/, '');
    document.querySelectorAll('[data-version]').forEach(el => {
      el.textContent = `v${version}`;
    });

    const asset = re => rel.assets.find(a => re.test(a.name))?.browser_download_url;
    const isWin = navigator.platform.startsWith('Win');
    const mac = asset(/aarch64\.dmg$/) || asset(/\.dmg$/);
    const win = asset(/setup\.exe$/) || asset(/\.msi$/);

    document.querySelectorAll('[data-download-mac]').forEach(el => {
      if (isWin && win) { el.textContent = 'Download for Windows'; el.href = win; }
      else if (mac) el.href = mac;
    });
    document.querySelectorAll('[data-download]').forEach(el => {
      const url = isWin ? win : mac;
      if (url) el.href = url;
    });
  } catch { /* ponytail: releases page fallback is good enough */ }
})();
