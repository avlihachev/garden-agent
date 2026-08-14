import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import type { GardenStore } from "../state/store.js";
import { DEFAULT_SEASON, type Season } from "../season.js";

// ../../public works from both src/ (tsx) and dist/ (tsc output)
const HTML_PATH = fileURLToPath(new URL("../../public/dashboard.html", import.meta.url));

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

// only accept requests addressed to this loopback server, to block DNS rebinding
const ALLOWED_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_STATUS = ["open", "done", "dropped"];
const PLANT_STATUS = ["seed", "seedling", "planted", "dormant", "done"];
const EVENT_TYPE = ["sown", "transplanted", "harvested", "treated", "note"];

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
// a window edge: null clears it, a string has to be a plain YYYY-MM-DD
const isDateOrNull = (v: unknown): boolean => v === null || (typeof v === "string" && DATE.test(v));
const isObject = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);

export function startDashboard(store: GardenStore, port: number,
  season: Season = DEFAULT_SEASON): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;
    try {
      if (!ALLOWED_HOST.test(req.headers.host || "")) {
        sendJson(res, 403, { error: "forbidden host" });
        return;
      }
      if ((req.method === "PATCH" || req.method === "POST") &&
        !(req.headers["content-type"] || "").startsWith("application/json")) {
        sendJson(res, 415, { error: "json only" });
        return;
      }
      if (req.method === "GET" && path === "/") {
        const html = await readFile(HTML_PATH, "utf-8").catch(() => "<h1>dashboard.html missing</h1>");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && path === "/api/state") {
        const all = store.listTasks();
        const open = all.filter(t => t.status === "open");
        // closed tasks grow without bound, so cap them at the 50 most recent
        // (nulls last, then id desc) instead of shipping the whole history
        const closed = all
          .filter(t => t.status !== "open")
          .sort((a, b) => {
            if (a.completedAt !== b.completedAt) {
              if (a.completedAt === null) return 1;
              if (b.completedAt === null) return -1;
              return a.completedAt < b.completedAt ? 1 : -1;
            }
            return b.id - a.id;
          })
          .slice(0, 50);
        const tasks = [...open, ...closed].map(t => ({ ...t, notes: store.listTaskNotes(t.id) }));
        const plants = store.listPlants().map(p => ({ ...p, events: store.listPlantEvents(p.id) }));
        sendJson(res, 200, { tasks, plants, season });
        return;
      }
      const patchMatch = path.match(/^\/api\/tasks\/(\d+)$/);
      if (req.method === "PATCH" && patchMatch) {
        const body = await readJsonBody(req);
        if (!isObject(body)) { sendJson(res, 400, { error: "object expected" }); return; }
        const before = store.getTask(Number(patchMatch[1])); // 404s through the catch when missing
        const patch: Parameters<GardenStore["updateTask"]>[1] = {};
        if ("status" in body) {
          if (!TASK_STATUS.includes(body.status)) { sendJson(res, 400, { error: "bad status" }); return; }
          patch.status = body.status;
        }
        if ("title" in body) {
          if (!isText(body.title)) { sendJson(res, 400, { error: "title required" }); return; }
          patch.title = body.title.trim();
        }
        if ("details" in body) {
          if (typeof body.details !== "string") { sendJson(res, 400, { error: "details must be text" }); return; }
          patch.details = body.details.trim();
        }
        if ("dueStart" in body) {
          if (!isDateOrNull(body.dueStart)) { sendJson(res, 400, { error: "dueStart must be YYYY-MM-DD or null" }); return; }
          patch.dueStart = body.dueStart;
        }
        if ("dueEnd" in body) {
          if (!isDateOrNull(body.dueEnd)) { sendJson(res, 400, { error: "dueEnd must be YYYY-MM-DD or null" }); return; }
          patch.dueEnd = body.dueEnd;
        }
        // keep due_end >= due_start: a lone null end collapses the window to one day
        const startAfter = patch.dueStart !== undefined ? patch.dueStart : before.dueStart;
        if (patch.dueEnd === null && startAfter) patch.dueEnd = startAfter;
        if (startAfter && patch.dueEnd && patch.dueEnd < startAfter) {
          sendJson(res, 400, { error: "dueEnd before dueStart" });
          return;
        }
        if (!Object.keys(patch).length) { sendJson(res, 400, { error: "nothing to update" }); return; }
        sendJson(res, 200, store.updateTask(before.id, patch));
        return;
      }
      const plantMatch = path.match(/^\/api\/plants\/(\d+)$/);
      if (req.method === "PATCH" && plantMatch) {
        const body = await readJsonBody(req);
        if (!isObject(body)) { sendJson(res, 400, { error: "object expected" }); return; }
        const patch: Record<string, unknown> = {};
        if ("status" in body) {
          if (!PLANT_STATUS.includes(body.status)) { sendJson(res, 400, { error: "bad status" }); return; }
          patch.status = body.status;
        }
        if ("location" in body) {
          if (!isText(body.location)) { sendJson(res, 400, { error: "location required" }); return; }
          patch.location = body.location.trim();
        }
        if ("notes" in body) {
          if (typeof body.notes !== "string" && body.notes !== null) {
            sendJson(res, 400, { error: "notes must be text or null" });
            return;
          }
          patch.notes = isText(body.notes) ? body.notes.trim() : null;
        }
        if (!Object.keys(patch).length) { sendJson(res, 400, { error: "nothing to update" }); return; }
        sendJson(res, 200, store.updatePlant(Number(plantMatch[1]), patch));
        return;
      }
      const eventMatch = path.match(/^\/api\/plants\/(\d+)\/events$/);
      if (req.method === "POST" && eventMatch) {
        const body = await readJsonBody(req);
        if (!isObject(body)) { sendJson(res, 400, { error: "object expected" }); return; }
        if (!EVENT_TYPE.includes(body.type)) { sendJson(res, 400, { error: "bad event type" }); return; }
        const note = isText(body.note) ? body.note.trim() : undefined;
        if (body.type === "note" && !note) { sendJson(res, 400, { error: "text required" }); return; }
        sendJson(res, 201, store.logPlantEvent(Number(eventMatch[1]), body.type, note, "me"));
        return;
      }
      const noteMatch = path.match(/^\/api\/tasks\/(\d+)\/notes$/);
      if (req.method === "POST" && noteMatch) {
        const body = await readJsonBody(req);
        if (typeof body.text !== "string" || !body.text.trim()) {
          sendJson(res, 400, { error: "text required" });
          return;
        }
        sendJson(res, 201, store.addTaskNote(Number(noteMatch[1]), "me", body.text.trim()));
        return;
      }
      const noteEditMatch = path.match(/^\/api\/tasks\/(\d+)\/notes\/(\d+)$/);
      if (req.method === "PATCH" && noteEditMatch) {
        const body = await readJsonBody(req);
        if (!isObject(body)) { sendJson(res, 400, { error: "object expected" }); return; }
        if (!isText(body.text)) { sendJson(res, 400, { error: "text required" }); return; }
        const [taskId, noteId] = [Number(noteEditMatch[1]), Number(noteEditMatch[2])];
        // a note id alone would let one task's thread edit another's
        if (!store.listTaskNotes(taskId).some(n => n.id === noteId)) {
          sendJson(res, 404, { error: "note not found on this task" });
          return;
        }
        sendJson(res, 200, store.updateTaskNote(noteId, body.text.trim()));
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof SyntaxError) sendJson(res, 400, { error: "invalid json" });
      else if (msg.includes("not found")) sendJson(res, 404, { error: msg });
      else sendJson(res, 500, { error: msg });
    }
  });
  return new Promise((resolve, reject) => {
    let started = false;
    // without this listener, EADDRINUSE (or any later socket error) is an
    // unhandled 'error' event and takes the whole process down with it.
    server.on("error", (err) => {
      if (!started) reject(err);
      else console.error("Dashboard server error:", err);
    });
    server.listen(port, "127.0.0.1", () => {
      started = true;
      resolve(server);
    });
  });
}
