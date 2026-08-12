import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../state/db.js";
import { GardenStore } from "../state/store.js";

// in-memory DB per test — node:sqlite supports ':memory:'
let store: GardenStore;
beforeEach(() => { store = new GardenStore(openDb(":memory:")); });

describe("tasks", () => {
  it("adds a task; single date becomes a one-day window", () => {
    const t = store.addTask({ title: "Sow radish", dueStart: "2026-04-25" });
    expect(t.id).toBe(1);
    expect(t.status).toBe("open");
    expect(t.dueEnd).toBe("2026-04-25");
    expect(t.source).toBe("agent");
  });

  it("filters by window relative to today", () => {
    store.addTask({ title: "overdue", dueStart: "2026-04-01", dueEnd: "2026-04-10" });
    store.addTask({ title: "current", dueStart: "2026-04-20", dueEnd: "2026-04-30" });
    store.addTask({ title: "later", dueStart: "2026-06-01", dueEnd: "2026-06-15" });
    store.addTask({ title: "someday" });
    const today = "2026-04-25";
    expect(store.listTasks({ window: "overdue" }, today).map(t => t.title)).toEqual(["overdue"]);
    expect(store.listTasks({ window: "today" }, today).map(t => t.title)).toEqual(["current"]);
    expect(store.listTasks({ window: "week" }, today).map(t => t.title))
      .toEqual(["overdue", "current"]);
    expect(store.listTasks({}, today)).toHaveLength(4);
  });

  it("closing a yearly task spawns next year's copy", () => {
    const t = store.addTask({ title: "Prune apple", dueStart: "2026-04-01", dueEnd: "2026-04-20", recurrence: "yearly" });
    const closed = store.updateTask(t.id, { status: "done" }, "2026-04-15");
    expect(closed.status).toBe("done");
    expect(closed.completedAt).toBeTruthy();
    const open = store.listTasks({ status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].dueStart).toBe("2027-04-01");
    expect(open[0].dueEnd).toBe("2027-04-20");
    expect(open[0].recurrence).toBe("yearly");
  });

  it("closing a days:N task spawns copy N days from today", () => {
    const t = store.addTask({ title: "Water chili", recurrence: "days:3" });
    store.updateTask(t.id, { status: "done" }, "2026-07-01");
    const open = store.listTasks({ status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].dueStart).toBe("2026-07-04");
    expect(open[0].dueEnd).toBe("2026-07-04");
  });

  it("notes thread with authors", () => {
    const t = store.addTask({ title: "Mulch" });
    store.addTaskNote(t.id, "agent", "bark, 5cm layer");
    store.addTaskNote(t.id, "me", "bought 100L");
    const notes = store.listTaskNotes(t.id);
    expect(notes.map(n => n.author)).toEqual(["agent", "me"]);
  });

  it("patch with explicit null clears a date", () => {
    const t = store.addTask({ title: "x", dueStart: "2026-05-01" });
    const u = store.updateTask(t.id, { dueStart: null, dueEnd: null });
    expect(u.dueStart).toBeNull();
  });

  it("patching dueStart alone on a someday task gives it a due_end and puts it in today's window", () => {
    const t = store.addTask({ title: "someday" });
    const u = store.updateTask(t.id, { dueStart: "2026-04-25" });
    expect(u.dueEnd).toBe("2026-04-25");
    const today = store.listTasks({ window: "today" }, "2026-04-25");
    expect(today.map(x => x.title)).toEqual(["someday"]);
    expect(store.formatOpenTasks("2026-04-25")).not.toBe("");
  });

  it("patching dueStart beyond the existing dueEnd does not leave the task permanently overdue", () => {
    const t = store.addTask({ title: "y", dueStart: "2026-04-01", dueEnd: "2026-04-05" });
    const u = store.updateTask(t.id, { dueStart: "2026-04-20" });
    expect(u.dueEnd! >= u.dueStart!).toBe(true);
    expect(store.listTasks({ window: "overdue" }, "2026-04-20")).toHaveLength(0);
  });

  it("reopening a task clears completedAt", () => {
    const t = store.addTask({ title: "z" });
    store.updateTask(t.id, { status: "done" });
    const reopened = store.updateTask(t.id, { status: "open" });
    expect(reopened.status).toBe("open");
    expect(reopened.completedAt).toBeNull();
  });

  it("rejects a free-text recurrence like 'weekly'", () => {
    expect(() => store.addTask({ title: "x", recurrence: "weekly" })).toThrow(/invalid recurrence/);
  });

  it("rejects days:0", () => {
    expect(() => store.addTask({ title: "x", recurrence: "days:0" })).toThrow(/invalid recurrence/);
  });

  it("accepts 'yearly' and 'days:14'", () => {
    expect(store.addTask({ title: "x", recurrence: "yearly" }).recurrence).toBe("yearly");
    expect(store.addTask({ title: "y", recurrence: "days:14" }).recurrence).toBe("days:14");
  });
});
