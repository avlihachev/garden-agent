import type { DatabaseSync } from "node:sqlite";

export interface Task {
  id: number; title: string; details: string | null; plantId: number | null;
  status: "open" | "done" | "dropped";
  dueStart: string | null; dueEnd: string | null; recurrence: string | null;
  source: "agent" | "user"; createdAt: string; completedAt: string | null;
}
export interface TaskNote { id: number; taskId: number; ts: string; author: "me" | "agent"; text: string; }
export type TaskWindow = "today" | "week" | "overdue" | "all";

export interface Plant {
  id: number; name: string; kind: string; variety: string | null; location: string;
  status: "seed" | "seedling" | "planted" | "dormant" | "done";
  sownAt: string | null; plantedOutAt: string | null; notes: string | null; createdAt: string;
}
export interface PlantEvent { id: number; plantId: number; ts: string; type: string; note: string | null; }

function isoDate(d: Date): string { return d.toISOString().split("T")[0]; }
function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
function addYears(date: string, years: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return isoDate(d);
}

function rowToTask(r: any): Task {
  return {
    id: r.id, title: r.title, details: r.details, plantId: r.plant_id,
    status: r.status, dueStart: r.due_start, dueEnd: r.due_end,
    recurrence: r.recurrence, source: r.source,
    createdAt: r.created_at, completedAt: r.completed_at,
  };
}

function rowToPlant(r: any): Plant {
  return {
    id: r.id, name: r.name, kind: r.kind, variety: r.variety, location: r.location,
    status: r.status, sownAt: r.sown_at, plantedOutAt: r.planted_out_at,
    notes: r.notes, createdAt: r.created_at,
  };
}

export class GardenStore {
  constructor(private db: DatabaseSync) {}

  addTask(input: { title: string; details?: string; plantId?: number; dueStart?: string;
    dueEnd?: string; recurrence?: string; source?: "agent" | "user" }): Task {
    const dueStart = input.dueStart ?? null;
    const dueEnd = input.dueEnd ?? dueStart;
    const res = this.db.prepare(
      `INSERT INTO tasks (title, details, plant_id, due_start, due_end, recurrence, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(input.title, input.details ?? null, input.plantId ?? null,
      dueStart, dueEnd, input.recurrence ?? null,
      input.source ?? "agent", new Date().toISOString());
    return this.getTask(Number(res.lastInsertRowid));
  }

  getTask(id: number): Task {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!row) throw new Error(`task ${id} not found`);
    return rowToTask(row);
  }

  listTasks(filter: { status?: Task["status"]; window?: TaskWindow; plantId?: number } = {},
    today: string = isoDate(new Date())): Task[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) { where.push("status = ?"); params.push(filter.status); }
    if (filter.plantId) { where.push("plant_id = ?"); params.push(filter.plantId); }
    switch (filter.window) {
      case "overdue":
        where.push("status = 'open'", "due_end IS NOT NULL", "due_end < ?"); params.push(today); break;
      case "today":
        where.push("status = 'open'", "due_start <= ?", "due_end >= ?"); params.push(today, today); break;
      case "week":
        where.push("status = 'open'", "due_start IS NOT NULL", "due_start <= ?");
        params.push(addDays(today, 7)); break;
    }
    const sql = `SELECT * FROM tasks${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY due_start IS NULL, due_start, id`;
    return this.db.prepare(sql).all(...(params as any[])).map(rowToTask);
  }

  updateTask(id: number, patch: { status?: Task["status"]; title?: string; details?: string;
    dueStart?: string | null; dueEnd?: string | null }, today: string = isoDate(new Date())): Task {
    const before = this.getTask(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) { sets.push("title = ?"); params.push(patch.title); }
    if (patch.details !== undefined) { sets.push("details = ?"); params.push(patch.details); }
    // dueEnd follows dueStart when the caller only patches dueStart, keeping the
    // due_end >= due_start invariant that addTask establishes on insert.
    let dueEnd = patch.dueEnd;
    if (patch.dueStart !== undefined && patch.dueEnd === undefined) {
      dueEnd = patch.dueStart === null ? null
        : (before.dueEnd === null || before.dueEnd < patch.dueStart) ? patch.dueStart
        : before.dueEnd;
    }
    if (patch.dueStart !== undefined) { sets.push("due_start = ?"); params.push(patch.dueStart); }
    if (dueEnd !== undefined) { sets.push("due_end = ?"); params.push(dueEnd); }
    if (patch.status !== undefined) {
      sets.push("status = ?"); params.push(patch.status);
      sets.push("completed_at = ?");
      params.push(patch.status === "done" ? new Date().toISOString() : null);
    }
    if (sets.length) {
      params.push(id);
      this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(params as any[]));
    }
    // done + recurrence spawns the next open copy
    if (patch.status === "done" && before.recurrence && before.status !== "done") {
      let dueStart: string | null = null;
      let dueEnd: string | null = null;
      if (before.recurrence === "yearly") {
        dueStart = before.dueStart ? addYears(before.dueStart, 1) : null;
        dueEnd = before.dueEnd ? addYears(before.dueEnd, 1) : null;
      } else if (before.recurrence.startsWith("days:")) {
        const n = parseInt(before.recurrence.slice(5), 10);
        dueStart = dueEnd = addDays(today, n);
      }
      this.addTask({
        title: before.title, details: before.details ?? undefined,
        plantId: before.plantId ?? undefined,
        dueStart: dueStart ?? undefined, dueEnd: dueEnd ?? undefined,
        recurrence: before.recurrence,
      });
    }
    return this.getTask(id);
  }

  addTaskNote(taskId: number, author: "me" | "agent", text: string): TaskNote {
    this.getTask(taskId); // throws if missing
    const res = this.db.prepare(
      "INSERT INTO task_notes (task_id, ts, author, text) VALUES (?, ?, ?, ?)"
    ).run(taskId, new Date().toISOString(), author, text);
    const row = this.db.prepare("SELECT * FROM task_notes WHERE id = ?").get(Number(res.lastInsertRowid)) as any;
    return { id: row.id, taskId: row.task_id, ts: row.ts, author: row.author, text: row.text };
  }

  listTaskNotes(taskId: number): TaskNote[] {
    return (this.db.prepare("SELECT * FROM task_notes WHERE task_id = ? ORDER BY ts, id").all(taskId) as any[])
      .map(r => ({ id: r.id, taskId: r.task_id, ts: r.ts, author: r.author, text: r.text }));
  }

  addPlant(input: { name: string; kind: string; variety?: string; location: string;
    status: Plant["status"]; sownAt?: string; notes?: string }): Plant {
    const res = this.db.prepare(
      `INSERT INTO plants (name, kind, variety, location, status, sown_at, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(input.name, input.kind, input.variety ?? null, input.location,
      input.status, input.sownAt ?? null, input.notes ?? null, new Date().toISOString());
    return this.getPlant(Number(res.lastInsertRowid));
  }

  getPlant(id: number): Plant {
    const row = this.db.prepare("SELECT * FROM plants WHERE id = ?").get(id);
    if (!row) throw new Error(`plant ${id} not found`);
    return rowToPlant(row);
  }

  listPlants(filter: { status?: Plant["status"]; location?: string } = {}): Plant[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) { where.push("status = ?"); params.push(filter.status); }
    if (filter.location) { where.push("location = ?"); params.push(filter.location); }
    const sql = `SELECT * FROM plants${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY location, name`;
    return this.db.prepare(sql).all(...(params as any[])).map(rowToPlant);
  }

  updatePlant(id: number, patch: Partial<Pick<Plant, "name"|"kind"|"variety"|"location"|"status"|"sownAt"|"plantedOutAt"|"notes">>): Plant {
    const cols: Record<string, string> = {
      name: "name", kind: "kind", variety: "variety", location: "location",
      status: "status", sownAt: "sown_at", plantedOutAt: "planted_out_at", notes: "notes",
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(cols)) {
      const v = (patch as any)[k];
      if (v !== undefined) { sets.push(`${col} = ?`); params.push(v); }
    }
    if (sets.length) {
      params.push(id);
      this.db.prepare(`UPDATE plants SET ${sets.join(", ")} WHERE id = ?`).run(...(params as any[]));
    }
    return this.getPlant(id);
  }

  logPlantEvent(plantId: number, type: "sown"|"transplanted"|"harvested"|"treated"|"note", note?: string): PlantEvent {
    const plant = this.getPlant(plantId);
    const ts = new Date().toISOString();
    const res = this.db.prepare(
      "INSERT INTO plant_events (plant_id, ts, type, note) VALUES (?, ?, ?, ?)"
    ).run(plantId, ts, type, note ?? null);
    const today = ts.split("T")[0];
    if (type === "sown" && !plant.sownAt) this.updatePlant(plantId, { sownAt: today });
    if (type === "transplanted" && !plant.plantedOutAt) this.updatePlant(plantId, { plantedOutAt: today });
    const row = this.db.prepare("SELECT * FROM plant_events WHERE id = ?").get(Number(res.lastInsertRowid)) as any;
    return { id: row.id, plantId: row.plant_id, ts: row.ts, type: row.type, note: row.note };
  }

  listPlantEvents(plantId: number): PlantEvent[] {
    return (this.db.prepare("SELECT * FROM plant_events WHERE plant_id = ? ORDER BY ts, id").all(plantId) as any[])
      .map(r => ({ id: r.id, plantId: r.plant_id, ts: r.ts, type: r.type, note: r.note }));
  }

  dueSummary(today: string = new Date().toISOString().split("T")[0]): { overdue: Task[]; today: Task[] } {
    return {
      overdue: this.listTasks({ window: "overdue" }, today),
      today: this.listTasks({ window: "today" }, today),
    };
  }

  formatOpenTasks(today: string = new Date().toISOString().split("T")[0]): string {
    const open = this.listTasks({ status: "open" }, today);
    if (open.length === 0) return "No open tasks.";
    const line = (t: Task) => {
      const win = t.dueStart ? `[${t.dueStart}..${t.dueEnd}]` : "[someday]";
      const plant = t.plantId ? ` (plant #${t.plantId})` : "";
      return `#${t.id} ${win} ${t.title}${plant}`;
    };
    // effective end falls back to dueStart so a task with dueStart set and dueEnd
    // NULL still lands in a bucket instead of being silently dropped from all four.
    const effectiveEnd = (t: Task) => t.dueEnd ?? t.dueStart;
    const overdue = open.filter(t => t.dueStart && effectiveEnd(t)! < today);
    const current = open.filter(t => t.dueStart && t.dueStart <= today && effectiveEnd(t)! >= today);
    const later = open.filter(t => t.dueStart && t.dueStart > today);
    const someday = open.filter(t => !t.dueStart);
    const sections: string[] = [];
    if (overdue.length) sections.push("OVERDUE:\n" + overdue.map(line).join("\n"));
    if (current.length) sections.push("CURRENT:\n" + current.map(line).join("\n"));
    if (later.length) sections.push("LATER:\n" + later.map(line).join("\n"));
    if (someday.length) sections.push("SOMEDAY:\n" + someday.map(line).join("\n"));
    return sections.join("\n\n");
  }
}
