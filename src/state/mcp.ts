import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { GardenStore } from "./store.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

// plain descriptors so handlers are testable without the SDK runtime
export function buildTools(store: GardenStore) {
  return [
    {
      name: "tasks_list",
      description: "List garden tasks. window: today|week|overdue|all",
      schema: {
        status: z.enum(["open", "done", "dropped"]).optional(),
        window: z.enum(["today", "week", "overdue", "all"]).optional(),
        plant_id: z.number().optional(),
      },
      handler: async (a: any) => json(store.listTasks({
        status: a.status, window: a.window === "all" ? undefined : a.window, plantId: a.plant_id,
      })),
    },
    {
      name: "task_add",
      description: "Add a garden task. Dates are YYYY-MM-DD; a window is due_start..due_end, an exact date is due_start only. recurrence: 'yearly' or 'days:N'.",
      schema: {
        title: z.string(),
        details: z.string().optional(),
        plant_id: z.number().optional(),
        due_start: z.string().optional(),
        due_end: z.string().optional(),
        recurrence: z.string().regex(/^(yearly|days:[1-9]\d{0,3})$/).optional(),
      },
      handler: async (a: any) => json(store.addTask({
        title: a.title, details: a.details, plantId: a.plant_id,
        dueStart: a.due_start, dueEnd: a.due_end, recurrence: a.recurrence,
      })),
    },
    {
      name: "task_update",
      description: "Update a task: close (status done), drop, reopen, change dates/title/details. Closing a recurring task auto-creates the next occurrence.",
      schema: {
        id: z.number(),
        status: z.enum(["open", "done", "dropped"]).optional(),
        title: z.string().optional(),
        details: z.string().optional(),
        due_start: z.string().nullable().optional(),
        due_end: z.string().nullable().optional(),
      },
      handler: async (a: any) => json(store.updateTask(a.id, {
        status: a.status, title: a.title, details: a.details,
        dueStart: a.due_start, dueEnd: a.due_end,
      })),
    },
    {
      name: "task_note",
      description: "Append a note to a task's thread (author: agent).",
      schema: { id: z.number(), text: z.string() },
      handler: async (a: any) => json(store.addTaskNote(a.id, "agent", a.text)),
    },
    {
      name: "plant_list",
      description: "List plants, optionally by status or location.",
      schema: {
        status: z.enum(["seed", "seedling", "planted", "dormant", "done"]).optional(),
        location: z.string().optional(),
      },
      handler: async (a: any) => json(store.listPlants({ status: a.status, location: a.location })),
    },
    {
      name: "plant_add",
      description: "Register a plant in the garden registry.",
      schema: {
        name: z.string(), kind: z.string(), variety: z.string().optional(),
        location: z.string(),
        status: z.enum(["seed", "seedling", "planted", "dormant", "done"]),
        sown_at: z.string().optional(), notes: z.string().optional(),
      },
      handler: async (a: any) => json(store.addPlant({
        name: a.name, kind: a.kind, variety: a.variety, location: a.location,
        status: a.status, sownAt: a.sown_at, notes: a.notes,
      })),
    },
    {
      name: "plant_update",
      description: "Update a plant's registry fields.",
      schema: {
        id: z.number(), name: z.string().optional(), kind: z.string().optional(),
        variety: z.string().optional(), location: z.string().optional(),
        status: z.enum(["seed", "seedling", "planted", "dormant", "done"]).optional(),
        sown_at: z.string().optional(), planted_out_at: z.string().optional(),
        notes: z.string().optional(),
      },
      handler: async (a: any) => json(store.updatePlant(a.id, {
        name: a.name, kind: a.kind, variety: a.variety, location: a.location,
        status: a.status, sownAt: a.sown_at, plantedOutAt: a.planted_out_at, notes: a.notes,
      })),
    },
    {
      name: "plant_log_event",
      description: "Log a plant event: sown|transplanted|harvested|treated|note. 'sown'/'transplanted' backfill the plant's dates.",
      schema: {
        id: z.number(),
        type: z.enum(["sown", "transplanted", "harvested", "treated", "note"]),
        note: z.string().optional(),
      },
      handler: async (a: any) => json(store.logPlantEvent(a.id, a.type, a.note)),
    },
  ];
}

export function createGardenStateServer(store: GardenStore) {
  return createSdkMcpServer({
    name: "garden-state",
    version: "1.0.0",
    tools: buildTools(store).map(t => tool(t.name, t.description, t.schema as any, t.handler)),
  });
}
