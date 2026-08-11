import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "http";
import { openDb } from "../state/db.js";
import { GardenStore } from "../state/store.js";
import { startDashboard } from "../dashboard/server.js";

let store: GardenStore;
let server: Server;
let base: string;

beforeEach(async () => {
  store = new GardenStore(openDb(":memory:"));
  server = await startDashboard(store, 0); // 0 = ephemeral port
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(() => new Promise<void>((res) => server.close(() => res())));

describe("dashboard api", () => {
  it("GET /api/state returns tasks with notes and plants with events", async () => {
    const t = store.addTask({ title: "Mulch" });
    store.addTaskNote(t.id, "agent", "bark");
    const p = store.addPlant({ name: "Basil", kind: "basil", location: "sill", status: "seed" });
    store.logPlantEvent(p.id, "sown");
    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tasks[0].notes).toHaveLength(1);
    expect(body.plants[0].events).toHaveLength(1);
  });

  it("PATCH /api/tasks/:id closes a task", async () => {
    const t = store.addTask({ title: "Water" });
    const res = await fetch(`${base}/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("done");
  });

  it("POST /api/tasks/:id/notes adds an owner note", async () => {
    const t = store.addTask({ title: "Prune" });
    const res = await fetch(`${base}/api/tasks/${t.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "left side only" }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).author).toBe("me");
  });

  it("404 on unknown task, 400 on bad json", async () => {
    const bad = await fetch(`${base}/api/tasks/999`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(bad.status).toBe(404);
    const malformed = await fetch(`${base}/api/tasks/1/notes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    });
    expect(malformed.status).toBe(400);
  });
});
