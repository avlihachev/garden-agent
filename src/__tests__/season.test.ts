import { describe, it, expect } from "vitest";
import { parseSeason, DEFAULT_SEASON, readSeason } from "../season.js";

describe("frost dates from profile.md", () => {
  it("reads the tilde-prefixed prose the profile actually contains", () => {
    expect(parseSeason([
      "- City: Kokkola",
      "- Last frost date: ~June 15",
      "- First frost date: ~September 15",
    ].join("\n"))).toEqual({ lastFrost: "06-15", firstFrost: "09-15" });
  });

  it("accepts the other shapes a human might write", () => {
    expect(parseSeason("Last frost date: 5 May\nFirst frost date: 09-30"))
      .toEqual({ lastFrost: "05-05", firstFrost: "09-30" });
    expect(parseSeason("last frost date: june 1\nfirst frost date: Oct 2"))
      .toEqual({ lastFrost: "06-01", firstFrost: "10-02" });
  });

  it("falls back per field instead of throwing on nonsense", () => {
    expect(parseSeason("Last frost date: whenever\nFirst frost date: ~August 20"))
      .toEqual({ lastFrost: DEFAULT_SEASON.lastFrost, firstFrost: "08-20" });
    expect(parseSeason("")).toEqual(DEFAULT_SEASON);
    expect(parseSeason("Last frost date: 13-45")).toEqual(DEFAULT_SEASON);
  });

  it("falls back when the profile is unreadable", () => {
    expect(readSeason("/nowhere/at/all")).toEqual(DEFAULT_SEASON);
  });
});
