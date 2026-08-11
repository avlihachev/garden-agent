import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import type { GardenStore } from "../state/store.js";

// ../../public works from both src/ (tsx) and dist/ (tsc output)
const HTML_PATH = fileURLToPath(new URL("../../public/dashboard.html", import.meta.url));

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

export function startDashboard(store: GardenStore, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/") {
        const html = await readFile(HTML_PATH, "utf-8").catch(() => "<h1>dashboard.html missing</h1>");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && path === "/api/state") {
        const tasks = store.listTasks().map(t => ({ ...t, notes: store.listTaskNotes(t.id) }));
        const plants = store.listPlants().map(p => ({ ...p, events: store.listPlantEvents(p.id) }));
        sendJson(res, 200, { tasks, plants });
        return;
      }
      const patchMatch = path.match(/^\/api\/tasks\/(\d+)$/);
      if (req.method === "PATCH" && patchMatch) {
        const body = await readJsonBody(req);
        sendJson(res, 200, store.updateTask(Number(patchMatch[1]), { status: body.status }));
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
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof SyntaxError) sendJson(res, 400, { error: "invalid json" });
      else if (msg.includes("not found")) sendJson(res, 404, { error: msg });
      else sendJson(res, 500, { error: msg });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
