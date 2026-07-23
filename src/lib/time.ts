import type { Work } from "./types";

// Audacity-style timecode: always MM:SS, HH:MM:SS when there are hours.
export function formatDuration(t: number): string {
  const s = Math.floor(t % 60);
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// SRT/subtitle convention: HH:MM:SS,mmm — millisecond precision, comma
// separator. This is the deliverable format, shown verbatim in the editor grid
// so fixing a subtitle feels like fixing the file itself.
export function formatTimecode(t: number): string {
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const s = Math.floor(t % 60);
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const pad = (n: number, l = 2) => n.toString().padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Inverse of formatTimecode, for the subtitle editor: parse HH:MM:SS,mmm (or
// with a `.` separator, hours optional) back to seconds. Returns null on a
// malformed edit so the field can snap back to its last good value.
export function parseTimecode(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return (
    (h ? +h * 3600 : 0) + +mm * 60 + +ss + (ms ? +ms.padEnd(3, "0") / 1000 : 0)
  );
}

// createdAt is an epoch-millis string from the Rust side (library::now).
export function formatRelative(ms: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24 && isToday(ms, now)) return `${hr}h`;
  if (isYesterday(ms, now)) return "Yesterday";
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const DAY = 86_400_000;
function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function isToday(ms: number, now: number) {
  return startOfDay(ms) === startOfDay(now);
}
function isYesterday(ms: number, now: number) {
  return startOfDay(ms) === startOfDay(now - DAY);
}

export interface Group {
  label: string;
  items: Work[];
}

// works assumed sorted DESC by created_at (the backend orders that way).
export function groupByDate(works: Work[]): Group[] {
  const now = Date.now();
  const groups: Group[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const w of works) {
    const ms = Number(w.createdAt);
    if (!ms) {
      groups[3].items.push(w);
      continue;
    }
    if (isToday(ms, now)) groups[0].items.push(w);
    else if (isYesterday(ms, now)) groups[1].items.push(w);
    else if (now - ms < 7 * DAY) groups[2].items.push(w);
    else groups[3].items.push(w);
  }
  return groups.filter((g) => g.items.length > 0);
}