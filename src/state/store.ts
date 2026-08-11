import type { DatabaseSync } from "node:sqlite";

export interface Task {
  id: number; title: string; details: string | null; plantId: number | null;
  status: "open" | "done" | "dropped";
  dueStart: string | null; dueEnd: string | null; recurrence: string | null;
  source: "agent" | "user"; createdAt: string; completedAt: string | null;
}
export interface TaskNote { id: number; taskId: number; ts: string; author: "me" | "agent"; text: string; }
export type TaskWindow = "today" | "week" | "overdue" | "all";

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
    if (patch.dueStart !== undefined) { sets.push("due_start = ?"); params.push(patch.dueStart); }
    if (patch.dueEnd !== undefined) { sets.push("due_end = ?"); params.push(patch.dueEnd); }
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
}
