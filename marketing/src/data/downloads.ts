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

export const downloads: Platform[] = [
  {
    os: "Windows",
    short: "Windows",
    file: ".msi installer",
    size: "9.4 MB",
    req: "Windows 10/11, 64-bit",
    href: "#",
  },
  {
    os: "macOS",
    short: "macOS",
    file: ".dmg (universal)",
    size: "11.2 MB",
    req: "macOS 12+, Apple Silicon & Intel",
    href: "#",
  },
  {
    os: "Linux",
    short: "Linux",
    file: ".AppImage",
    size: "12.1 MB",
    req: "glibc 2.31+, 64-bit",
    href: "#",
  },
];
