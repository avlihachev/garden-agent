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

async function fetchWeather(): Promise<Record<string, unknown> | undefined> {
  try {
    const lat = config.latitude;
    const lon = config.longitude;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&forecast_days=7`;
    const res = await axios.get(url, { timeout: 10000 });
    const d = res.data.daily;
    const forecast_7d = d.time.map((date: string, i: number) => ({
      date,
      temp_max: d.temperature_2m_max[i],
      temp_min: d.temperature_2m_min[i],
      precipitation_mm: d.precipitation_sum[i],
      wind_max_kmh: d.wind_speed_10m_max[i],
    }));
    return { forecast_7d, date: new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) };
  } catch {
    return undefined;
  }
}

export async function syncGardenData(dashboard?: DashboardData | null): Promise<void> {
  const [plants, journal, profile, tasks, weather] = await Promise.all([
    readFile(join(config.skillDir, "plants.md"), "utf-8").catch(() => ""),
    readFile(join(config.skillDir, "journal.md"), "utf-8").catch(() => ""),
    readFile(join(config.skillDir, "profile.md"), "utf-8").catch(() => ""),
    config.tasksFilePath
      ? readFile(config.tasksFilePath, "utf-8").catch(() => undefined)
      : Promise.resolve(undefined),
    fetchWeather(),
  ]);

  if (!plants && !journal && !profile) return;

  const payload: Record<string, unknown> = { plants, journal, profile, tasks, weather };
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
