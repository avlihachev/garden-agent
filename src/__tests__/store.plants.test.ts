import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../state/db.js";
import { GardenStore } from "../state/store.js";

let store: GardenStore;
beforeEach(() => { store = new GardenStore(openDb(":memory:")); });

describe("plants", () => {
  it("adds and lists by location", () => {
    store.addPlant({ name: "Tomato Balkonzauber", kind: "tomato", location: "балкон Ю", status: "seedling" });
    store.addPlant({ name: "Radish", kind: "radish", location: "грядка", status: "seed" });
    expect(store.listPlants({ location: "грядка" })).toHaveLength(1);
    expect(store.listPlants()).toHaveLength(2);
  });

  it("sown event backfills sown_at", () => {
    const p = store.addPlant({ name: "Chili", kind: "chili", location: "подоконник", status: "seed" });
    store.logPlantEvent(p.id, "sown", "3 seeds");
    expect(store.listPlants()[0].sownAt).toBeTruthy();
    expect(store.listPlantEvents(p.id)).toHaveLength(1);
  });

  it("formatOpenTasks groups by urgency", () => {
    store.addTask({ title: "overdue thing", dueStart: "2026-04-01", dueEnd: "2026-04-10" });
    store.addTask({ title: "current thing", dueStart: "2026-04-20", dueEnd: "2026-04-30" });
    store.addTask({ title: "someday thing" });
    const text = store.formatOpenTasks("2026-04-25");
    expect(text).toContain("OVERDUE:");
    expect(text).toContain("overdue thing");
    expect(text).toContain("CURRENT:");
    expect(text).toContain("SOMEDAY:");
  });

  it("dueSummary splits overdue and today", () => {
    store.addTask({ title: "late", dueStart: "2026-04-01", dueEnd: "2026-04-10" });
    store.addTask({ title: "now", dueStart: "2026-04-25", dueEnd: "2026-04-25" });
    const s = store.dueSummary("2026-04-25");
    expect(s.overdue.map(t => t.title)).toEqual(["late"]);
    expect(s.today.map(t => t.title)).toEqual(["now"]);
  });
});
