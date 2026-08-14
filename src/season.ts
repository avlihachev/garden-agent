import { readFileSync } from "fs";
import { join } from "path";

export interface Season { lastFrost: string; firstFrost: string }

// Kokkola, used when profile.md is missing or unparseable
export const DEFAULT_SEASON: Season = { lastFrost: "06-15", firstFrost: "09-15" };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// profile.md is prose, so accept what a human would plausibly write there:
// "~June 15", "June 15", "15 June", "06-15"
function parseDate(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/^~\s*/, "");

  const iso = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [month, day] = [Number(iso[1]), Number(iso[2])];
    return valid(month, day) ? pad(month, day) : null;
  }

  const named = text.match(/^([a-z]+)\s+(\d{1,2})$/) || text.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (!named) return null;
  const monthWord = /^\d/.test(named[1]) ? named[2] : named[1];
  const dayWord = /^\d/.test(named[1]) ? named[1] : named[2];
  const month = MONTHS.findIndex(m => m.startsWith(monthWord.slice(0, 3))) + 1;
  const day = Number(dayWord);
  return month && valid(month, day) ? pad(month, day) : null;
}

const valid = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31;
const pad = (month: number, day: number) =>
  `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function parseSeason(profile: string): Season {
  const pick = (label: string): string | null => {
    const line = profile.match(new RegExp(`${label}\\s*:\\s*(.+)`, "i"));
    return line ? parseDate(line[1]) : null;
  };
  return {
    lastFrost: pick("last frost date") ?? DEFAULT_SEASON.lastFrost,
    firstFrost: pick("first frost date") ?? DEFAULT_SEASON.firstFrost,
  };
}

export function readSeason(skillDir: string): Season {
  try {
    return parseSeason(readFileSync(join(skillDir, "profile.md"), "utf-8"));
  } catch {
    console.warn("profile.md unreadable, using default frost dates for Kokkola");
    return DEFAULT_SEASON;
  }
}
