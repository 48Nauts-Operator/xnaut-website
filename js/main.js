// Resolve latest release: version pill + direct download links.
// Falls back to the releases page (hrefs already in the HTML) on any failure.
(async () => {
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
    // Say only what this release actually ships. The site claimed Intel support
    // for four releases while the Intel dmg was failing to build — deriving the
    // list from the assets means the page cannot make that claim again.
    const platforms = [];
    if (asset(/aarch64\.dmg$/)) platforms.push('Apple Silicon');
    if (asset(/x64\.dmg$/) || asset(/x86_64.*\.dmg$/)) platforms.push('Intel');
    if (win) platforms.push('Windows x64');
    if (platforms.length) {
      const label = platforms.length > 1
        ? platforms.slice(0, -1).join(', ') + ' & ' + platforms[platforms.length - 1]
        : platforms[0];
      document.querySelectorAll('[data-platforms]').forEach(el => { el.textContent = label; });
    }

    document.querySelectorAll('[data-download]').forEach(el => {
      const url = isWin ? win : mac;
      if (url) el.href = url;
    });
  } catch { /* ponytail: releases page fallback is good enough */ }
})();

// Copy the install command from the hero.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => {
    const prev = b.textContent;
    b.textContent = 'copied'; b.classList.add('ok');
    setTimeout(() => { b.textContent = prev; b.classList.remove('ok'); }, 1200);
  }).catch(() => { /* clipboard blocked — the text is selectable anyway */ });
});

// Live adoption numbers, so the stats band cannot go stale the way the cask did.
// Falls back silently to the numbers already in the markup.
(async () => {
  try {
    const rs = await fetch('https://api.github.com/repos/48Nauts-Operator/xNaut/releases?per_page=100');
    if (!rs.ok) return;
    const releases = await rs.json();
    const downloads = releases.reduce((n, r) => n + (r.assets || []).reduce((m, a) => m + (a.download_count || 0), 0), 0);
    const fmt = (n) => n.toLocaleString('en-US');
    if (downloads) document.querySelectorAll('[data-gh-downloads]').forEach(el => { el.textContent = fmt(downloads); });
    if (releases.length) document.querySelectorAll('[data-gh-releases]').forEach(el => { el.textContent = fmt(releases.length); });
  } catch { /* offline or rate-limited: the static numbers stand */ }
})();
