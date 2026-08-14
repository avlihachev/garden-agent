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

  it("the agent may fix its own note but not the owner's", async () => {
    await call("task_add", { title: "Обрезка вишни" });
    await call("task_note", { id: 1, text: "окно 12-13.08" });
    const owners = store.addTaskNote(1, "me", "срезал только сухое");

    const fixed = await call("task_note_update", { id: 1, text: "окно 12-13.08, резерв 20-22.08" });
    expect(fixed.text).toBe("окно 12-13.08, резерв 20-22.08");

    await expect(call("task_note_update", { id: owners.id, text: "переписал владельца" }))
      .rejects.toThrow(/written by me/);
    expect(store.listTaskNotes(1)[1].text).toBe("срезал только сухое");
  });

  it("the agent may fix its own plant event but not the owner's", async () => {
    const p = await call("plant_add", { name: "Мята", kind: "herb", location: "грядка", status: "planted" });
    const mine = await call("plant_log_event", { id: p.id, type: "treated", note: "убраны сухие стебли" });
    const owners = store.logPlantEvent(p.id, "note", "не расползается", "me");

    const fixed = await call("plant_event_update", { id: mine.id, note: "убраны сухие стебли, весна 2026" });
    expect(fixed.note).toBe("убраны сухие стебли, весна 2026");

    await expect(call("plant_event_update", { id: owners.id, note: "подмена" }))
      .rejects.toThrow(/written by me/);
    expect(store.listPlantEvents(p.id)[1].note).toBe("не расползается");
  });

  // the owner answers in the thread from the dashboard; without this the reply is invisible
  it("tasks_list carries the note thread back to the agent", async () => {
    await call("task_add", { title: "Prune the cherry" });
    store.addTaskNote(1, "me", "срезал только сухое, на перевод не трогал");
    await call("task_note", { id: 1, text: "окно закрывается 22.08" });
    const listed = await call("tasks_list", { status: "open" });
    expect(listed[0].notes.map((n: any) => n.author)).toEqual(["me", "agent"]);
    expect(listed[0].notes[0].text).toContain("срезал только сухое");
  });

  it("plant_list carries the event history back to the agent", async () => {
    const p = await call("plant_add", { name: "Ива", kind: "tree", location: "участок", status: "planted" });
    store.logPlantEvent(p.id, "note", "трутовик на соседнем стволе");
    const plants = await call("plant_list", {});
    expect(plants[0].events).toHaveLength(1);
    expect(plants[0].events[0].note).toContain("трутовик");
  });
});
