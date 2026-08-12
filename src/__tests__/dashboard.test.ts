import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { request as httpRequest, type Server } from "http";
import { openDb } from "../state/db.js";
import { GardenStore } from "../state/store.js";
import { startDashboard } from "../dashboard/server.js";

let store: GardenStore;
let server: Server;
let base: string;
let port: number;

beforeEach(async () => {
  store = new GardenStore(openDb(":memory:"));
  server = await startDashboard(store, 0); // 0 = ephemeral port
  const addr = server.address() as { port: number };
  port = addr.port;
  base = `http://127.0.0.1:${port}`;
});

// fetch forbids overriding the Host header (undici enforces it silently), so
// a spoofed-host test has to go through node's own http client instead.
function rawRequest(path: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode!,
        body: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

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

  it("GET /api/state caps done/dropped tasks at 50 most recent, keeping all open ones", async () => {
    for (let i = 0; i < 55; i++) {
      const t = store.addTask({ title: `done-${i}` });
      store.updateTask(t.id, { status: "done" });
    }
    store.addTask({ title: "open-1" });
    store.addTask({ title: "open-2" });
    const res = await fetch(`${base}/api/state`);
    const body = (await res.json()) as any;
    expect(body.tasks).toHaveLength(52);
    const open = body.tasks.filter((t: any) => t.status === "open");
    expect(open.map((t: any) => t.title).sort()).toEqual(["open-1", "open-2"]);
  });

  it("starting a second dashboard on the same port rejects instead of crashing", async () => {
    const addr = server.address() as { port: number };
    await expect(startDashboard(store, addr.port)).rejects.toThrow();
  });

  it("rejects a spoofed Host header to guard against DNS rebinding", async () => {
    const res = await rawRequest("/api/state", { host: "evil.example" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden host" });
  });

  it("rejects a non-JSON content-type on writes to close a text/plain CSRF hole", async () => {
    const t = store.addTask({ title: "Prune" });
    const res = await fetch(`${base}/api/tasks/${t.id}/notes`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ text: "left side only" }),
    });
    expect(res.status).toBe(415);
    expect((await res.json()) as any).toEqual({ error: "json only" });
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
