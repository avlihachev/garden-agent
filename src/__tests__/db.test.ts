import { describe, it, expect, afterEach } from "vitest";
import { rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import { openDb } from "../state/db.js";

const paths: string[] = [];
function tmpDbPath(): string {
  const p = join(tmpdir(), `garden-db-${crypto.randomUUID()}.db`);
  paths.push(p);
  return p;
}

afterEach(async () => {
  for (const p of paths.splice(0)) await rm(p, { force: true });
});

describe("openDb", () => {
  it("creates all four tables and is idempotent", () => {
    const path = tmpDbPath();
    const db = openDb(path);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["plants", "plant_events", "tasks", "task_notes"])
    );
    db.close();
    // reopen must not throw on existing schema
    const db2 = openDb(path);
    db2.close();
  });
});
