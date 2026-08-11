import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../state/db.js";
import { GardenStore } from "../state/store.js";
import { buildTools } from "../state/mcp.js";

let store: GardenStore;
let tools: Map<string, (args: any) => Promise<any>>;

beforeEach(() => {
  store = new GardenStore(openDb(":memory:"));
  tools = new Map(buildTools(store).map(t => [t.name, t.handler]));
});

async function call(name: string, args: any): Promise<any> {
  const res = await tools.get(name)!(args);
  return JSON.parse(res.content[0].text);
}

describe("garden-state tools", () => {
  it("task_add then tasks_list round-trips", async () => {
    const added = await call("task_add", { title: "Sow peas", due_start: "2026-05-05" });
    expect(added.id).toBe(1);
    const listed = await call("tasks_list", { status: "open" });
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Sow peas");
  });

  it("task_update closes; task_note appends as agent", async () => {
    await call("task_add", { title: "Mulch" });
    const closed = await call("task_update", { id: 1, status: "done" });
    expect(closed.status).toBe("done");
    await call("task_add", { title: "Water" });
    const note = await call("task_note", { id: 2, text: "morning only" });
    expect(note.author).toBe("agent");
  });

  it("plant_add, plant_log_event, plant_list", async () => {
    const p = await call("plant_add", { name: "Basil", kind: "basil", location: "подоконник", status: "seed" });
    await call("plant_log_event", { id: p.id, type: "sown" });
    const plants = await call("plant_list", {});
    expect(plants[0].sownAt).toBeTruthy();
  });
});
