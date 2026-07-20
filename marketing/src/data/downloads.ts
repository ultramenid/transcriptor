// ponytail: placeholder sizes/reqs — no installers built yet. Update when the
// first release artifacts exist (models are downloaded on demand, not bundled,
// so the installer stays small).
export type Platform = {
  os: string;
  short: string;
  file: string;
  size: string;
  req: string;
  href: string;
};

const REPO = 'transcriptor/transcriptor';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

// Static fallback used when no release exists yet or the GitHub API is
// unreachable during a local build. Keeps `pnpm build` working pre-release.
const PLACEHOLDER: Platform[] = [
  {
    os: 'Windows',
    short: 'Windows',
    file: '.msi installer',
    size: '—',
    req: 'Windows 10/11, 64-bit',
    href: `https://github.com/${REPO}/releases/latest`,
  },
  {
    os: 'macOS',
    short: 'macOS',
    file: '.dmg (universal)',
    size: '—',
    req: 'macOS 12+, Apple Silicon & Intel',
    href: `https://github.com/${REPO}/releases/latest`,
  },
  {
    os: 'Linux',
    short: 'Linux',
    file: '.AppImage',
    size: '—',
    req: 'glibc 2.31+, 64-bit',
    href: `https://github.com/${REPO}/releases/latest`,
  },
];

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

// Match a release asset to one of the three platforms by file extension.
function platformForFile(name: string): Platform | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith('.msi')) {
    return { ...PLACEHOLDER[0], file: '.msi installer' };
  }
  if (lower.endsWith('.dmg')) {
    return { ...PLACEHOLDER[1], file: '.dmg (universal)' };
  }
  if (lower.endsWith('.appimage')) {
    return { ...PLACEHOLDER[2], file: '.AppImage' };
  }
  return undefined;
}

type GithubAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

type GithubRelease = {
  assets?: GithubAsset[];
};

// Fetch the latest release at build time and map its assets to platforms.
// Returns PLACEHOLDER (pointed at the releases page) if anything goes wrong,
// so the marketing site never breaks because of a GitHub API hiccup.
export async function getDownloads(): Promise<Platform[]> {
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return PLACEHOLDER;
    const release = (await res.json()) as GithubRelease;
    const assets = release.assets ?? [];

    const found: Platform[] = [];
    for (const asset of assets) {
      const base = platformForFile(asset.name);
      if (!base) continue;
      found.push({
        ...base,
        size: formatSize(asset.size),
        href: asset.browser_download_url,
      });
    }

    // Fill any platforms that had no matching asset with the placeholder so
    // all three cards always render.
    for (const placeholder of PLACEHOLDER) {
      if (!found.some((p) => p.short === placeholder.short)) {
        found.push(placeholder);
      }
    }

    // Preserve the Windows / macOS / Linux display order.
    return PLACEHOLDER.map((p) => found.find((f) => f.short === p.short) ?? p);
  } catch {
    return PLACEHOLDER;
  }
}