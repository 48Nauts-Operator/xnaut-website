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
//
// If the fetch fails — offline, or rate-limited, which is easy since this is an
// unauthenticated API capped at 60/hour per IP — the stat is REMOVED rather than
// left showing the number baked into the markup. A stale count does not look
// broken, it looks like a fact, which is the worse failure. Release CI keeps the
// markup values current as a floor (see release.yml), so what is shown is either
// live or as-of-the-last-release, never arbitrarily old.
(async () => {
  const hide = () => document.querySelectorAll('[data-gh-downloads],[data-gh-releases]')
    .forEach(el => { const s = el.closest('.stat'); if (s) s.hidden = true; });
  try {
    const rs = await fetch('https://api.github.com/repos/48Nauts-Operator/xNaut/releases?per_page=100');
    if (!rs.ok) return hide();
    const releases = await rs.json();
    if (!Array.isArray(releases) || !releases.length) return hide();
    const downloads = releases.reduce((n, r) => n + (r.assets || []).reduce((m, a) => m + (a.download_count || 0), 0), 0);
    const fmt = (n) => n.toLocaleString('en-US');
    if (!downloads) return hide();
    document.querySelectorAll('[data-gh-downloads]').forEach(el => { el.textContent = fmt(downloads); });
    document.querySelectorAll('[data-gh-releases]').forEach(el => { el.textContent = fmt(releases.length); });
  } catch { hide(); }
})();
