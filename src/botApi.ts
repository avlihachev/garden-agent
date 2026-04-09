import axios from "axios";
import { readFile } from "fs/promises";
import { join } from "path";
import { config } from "./config.js";
import { AgentMessage, DashboardData } from "./types.js";

export async function fetchMessages(): Promise<AgentMessage[]> {
  const url = `${config.botUrl}/api/agent/messages`;
  const response = await axios.get<{ messages: AgentMessage[] }>(url, {
    timeout: config.requestTimeoutMs,
    headers: { Authorization: `Bearer ${config.agentSecret}` },
  });
  return response.data.messages;
}

export async function sendReply(chatId: number, text: string): Promise<void> {
  await axios.post(
    `${config.botUrl}/api/agent/reply`,
    { chatId, text, parseMode: null },
    {
      timeout: config.requestTimeoutMs,
      headers: { Authorization: `Bearer ${config.agentSecret}` },
    }
  );
}

export async function syncGardenData(dashboard?: DashboardData | null): Promise<void> {
  const [plants, journal, profile, tasks] = await Promise.all([
    readFile(join(config.skillDir, "plants.md"), "utf-8").catch(() => ""),
    readFile(join(config.skillDir, "journal.md"), "utf-8").catch(() => ""),
    readFile(join(config.skillDir, "profile.md"), "utf-8").catch(() => ""),
    config.tasksFilePath
      ? readFile(config.tasksFilePath, "utf-8").catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  if (!plants && !journal && !profile) return;

  const payload: Record<string, unknown> = { plants, journal, profile, tasks };
  if (dashboard) {
    payload.timeline = dashboard.timeline;
    payload.calendar = dashboard.calendar;
  }

  await axios.post(
    `${config.botUrl}/api/garden/sync`,
    payload,
    {
      timeout: config.requestTimeoutMs,
      headers: { Authorization: `Bearer ${config.agentSecret}` },
    }
  );
}
