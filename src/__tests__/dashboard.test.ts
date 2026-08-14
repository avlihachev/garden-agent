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

  const patch = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("PATCH /api/tasks/:id edits the title and the window", async () => {
    const t = store.addTask({ title: "Prune", dueStart: "2026-08-01", dueEnd: "2026-08-10" });
    const res = await patch(`/api/tasks/${t.id}`, {
      title: "Prune the old cherry", dueStart: "2026-08-05", dueEnd: "2026-08-20",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Prune the old cherry");
    expect([body.dueStart, body.dueEnd]).toEqual(["2026-08-05", "2026-08-20"]);
  });

  it("PATCH /api/tasks/:id keeps due_end >= due_start", async () => {
    const t = store.addTask({ title: "Sow", dueStart: "2026-08-01", dueEnd: "2026-08-10" });
    const backwards = await patch(`/api/tasks/${t.id}`, { dueEnd: "2026-07-01" });
    expect(backwards.status).toBe(400);

    // a lone null end collapses the window to a single day instead of breaking it
    const cleared = await patch(`/api/tasks/${t.id}`, { dueEnd: null });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as any;
    expect([body.dueStart, body.dueEnd]).toEqual(["2026-08-01", "2026-08-01"]);
  });

  it("PATCH /api/tasks/:id rejects junk and empty patches", async () => {
    const t = store.addTask({ title: "Water" });
    expect((await patch(`/api/tasks/${t.id}`, { status: "cancelled" })).status).toBe(400);
    expect((await patch(`/api/tasks/${t.id}`, { title: "   " })).status).toBe(400);
    expect((await patch(`/api/tasks/${t.id}`, { dueStart: "05.08.2026" })).status).toBe(400);
    expect((await patch(`/api/tasks/${t.id}`, {})).status).toBe(400);
  });

  it("PATCH /api/tasks/:id/notes/:noteId edits a note and keeps its timestamp", async () => {
    const t = store.addTask({ title: "Prune" });
    const note = store.addTaskNote(t.id, "me", "срезал сухое");
    const res = await patch(`/api/tasks/${t.id}/notes/${note.id}`, { text: "срезал сухое и нижний ярус" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.text).toBe("срезал сухое и нижний ярус");
    expect(body.ts).toBe(note.ts);
    expect(body.author).toBe("me");
  });

  it("PATCH refuses to rewrite a note the agent wrote", async () => {
    const t = store.addTask({ title: "Prune" });
    const mine = store.addTaskNote(t.id, "agent", "окно закрывается 22.08");
    const res = await patch(`/api/tasks/${t.id}/notes/${mine.id}`, { text: "переписал за агента" });
    expect(res.status).toBe(403);
    expect(store.listTaskNotes(t.id)[0].text).toBe("окно закрывается 22.08");
  });

  it("PATCH /api/plants/:id/events/:eventId edits the owner's own event only", async () => {
    const p = store.addPlant({ name: "Mint", kind: "herb", location: "bed", status: "planted" });
    const byAgent = store.logPlantEvent(p.id, "treated", "срезаны сухие стебли");
    const mine = store.logPlantEvent(p.id, "note", "не расползается", "me");

    const ok = await patch(`/api/plants/${p.id}/events/${mine.id}`, { note: "совсем не расползается" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).note).toBe("совсем не расползается");

    const denied = await patch(`/api/plants/${p.id}/events/${byAgent.id}`, { note: "подмена" });
    expect(denied.status).toBe(403);
    expect(store.listPlantEvents(p.id)[0].note).toBe("срезаны сухие стебли");

    expect((await patch(`/api/plants/${p.id}/events/9999`, { note: "нет такого" })).status).toBe(404);
  });

  it("PATCH on a note of another task 404s instead of editing it", async () => {
    const a = store.addTask({ title: "A" });
    const b = store.addTask({ title: "B" });
    const note = store.addTaskNote(a.id, "me", "принадлежит A");
    const res = await patch(`/api/tasks/${b.id}/notes/${note.id}`, { text: "угнал" });
    expect(res.status).toBe(404);
    expect(store.listTaskNotes(a.id)[0].text).toBe("принадлежит A");
  });

  it("PATCH /api/tasks/:id/notes/:noteId rejects empty text", async () => {
    const t = store.addTask({ title: "Water" });
    const note = store.addTaskNote(t.id, "me", "утром");
    expect((await patch(`/api/tasks/${t.id}/notes/${note.id}`, { text: "   " })).status).toBe(400);
  });

  it("PATCH /api/plants/:id edits status, location and notes", async () => {
    const p = store.addPlant({ name: "Dill", kind: "herb", location: "sill", status: "seed" });
    const res = await patch(`/api/plants/${p.id}`, {
      status: "planted", location: "greenhouse", notes: "deep pot, taproot",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect([body.status, body.location, body.notes]).toEqual(["planted", "greenhouse", "deep pot, taproot"]);

    const cleared = await patch(`/api/plants/${p.id}`, { notes: "" });
    expect(((await cleared.json()) as any).notes).toBeNull();
  });

  it("PATCH /api/plants/:id rejects a bad status and 404s an unknown plant", async () => {
    const p = store.addPlant({ name: "Mint", kind: "herb", location: "bed", status: "planted" });
    expect((await patch(`/api/plants/${p.id}`, { status: "thriving" })).status).toBe(400);
    expect((await patch(`/api/plants/999`, { status: "done" })).status).toBe(404);
  });

  it("POST /api/plants/:id/events logs an event and backfills dates", async () => {
    const p = store.addPlant({ name: "Peas", kind: "vegetable", location: "balcony", status: "seed" });
    const res = await post(`/api/plants/${p.id}/events`, { type: "sown", note: "soaked overnight" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).type).toBe("sown");
    expect(store.getPlant(p.id).sownAt).not.toBeNull();
  });

  it("POST /api/plants/:id/events records the owner as the author", async () => {
    const p = store.addPlant({ name: "Mint", kind: "herb", location: "bed", status: "planted" });
    store.logPlantEvent(p.id, "treated", "срезаны сухие стебли"); // agent by default
    const res = await post(`/api/plants/${p.id}/events`, { type: "note", note: "не расползается" });
    expect(((await res.json()) as any).author).toBe("me");
    expect(store.listPlantEvents(p.id).map(e => e.author)).toEqual(["agent", "me"]);
  });

  it("GET /api/state exposes the frost dates the page draws its gates from", async () => {
    const res = await fetch(`${base}/api/state`);
    const body = (await res.json()) as any;
    expect(body.season).toEqual({ lastFrost: "06-15", firstFrost: "09-15" });
  });

  it("POST /api/plants/:id/events rejects a bad type and a noteless note", async () => {
    const p = store.addPlant({ name: "Kale", kind: "vegetable", location: "bed", status: "planted" });
    expect((await post(`/api/plants/${p.id}/events`, { type: "watered" })).status).toBe(400);
    expect((await post(`/api/plants/${p.id}/events`, { type: "note", note: "  " })).status).toBe(400);
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
