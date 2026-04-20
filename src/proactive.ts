import cron from "node-cron";
import axios from "axios";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { sendReply } from "./botApi.js";

let lastProactiveDate: string = "";
let lastFrostAlertDate: string = "";

async function morningCheck(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  if (lastProactiveDate === today) {
    console.log("⏭ Already sent proactive message today");
    return;
  }

  console.log("🌅 Running morning check...");
  try {
    const tasksInstruction = config.tasksFilePath
      ? ` Also read the tasks file at ${config.tasksFilePath} — review all sections including overdue items, upcoming deadlines, and "Questions to discuss" (process all information there and provide recommendations).`
      : "";
    const reply = await runAgent(
      "Check weather forecast for the next 7 days, seasonal calendar, and plant statuses." +
      tasksInstruction +
      " Report ONLY critical items that need immediate attention: frost risk, overdue tasks, " +
      "or time-sensitive actions. If everything is fine, respond with exactly: OK"
    );

    if (reply && reply.trim() !== "OK") {
      await sendReply(config.chatId, reply);
      lastProactiveDate = today;
      console.log("📤 Morning check sent");
    } else {
      console.log("✅ Morning check: nothing critical");
    }
  } catch (error) {
    console.error("Morning check error:", error instanceof Error ? error.message : error);
  }
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
}

async function frostCheck(): Promise<void> {
  console.log("❄️ Running frost check...");
  try {
    // direct Open-Meteo call — no LLM tokens
    const lat = config.latitude;
    const lon = config.longitude;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=2&timezone=auto&models=metno_seamless`;

    const response = await axios.get<{ hourly: OpenMeteoHourly }>(url, {
      timeout: 10000,
    });
    const { time, temperature_2m } = response.data.hourly;

    let hardFrost = false;
    let minTemp = Infinity;
    let minTime = "";

    for (let i = 0; i < temperature_2m.length; i++) {
      if (temperature_2m[i] < minTemp) {
        minTemp = temperature_2m[i];
        minTime = time[i];
      }
      if (temperature_2m[i] <= -2) {
        hardFrost = true;
      }
    }

    if (hardFrost) {
      const today = new Date().toISOString().split("T")[0];
      if (lastFrostAlertDate === today) {
        console.log("⏭ Already sent frost alert today");
        return;
      }
      const d = new Date(minTime);
      const formatted = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const msg = `🚨 FROST ALERT\n\nHard frost expected: ${minTemp}°C at ${formatted}\nProtect tender plants immediately!`;
      await sendReply(config.chatId, msg);
      lastFrostAlertDate = today;
      console.log(`🚨 Frost alert sent: ${minTemp}°C at ${minTime}`);
    } else {
      console.log(`✅ No frost risk (min: ${minTemp}°C)`);
    }
  } catch (error) {
    console.error("Frost check error:", error instanceof Error ? error.message : error);
  }
}

export function startProactive(): void {
  const timezone = "Europe/Helsinki";

  cron.schedule("0 8 * * *", morningCheck, { timezone });
  console.log("🌅 Morning check scheduled at 08:00 " + timezone);

  cron.schedule("0 */4 * * *", frostCheck, { timezone });
  console.log("❄️ Frost check scheduled every 4 hours " + timezone);
}
