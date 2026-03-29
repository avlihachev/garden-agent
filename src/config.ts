import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredInt(name: string): number {
  const value = parseInt(required(name), 10);
  if (isNaN(value)) throw new Error(`${name} must be a valid integer`);
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  if (isNaN(value)) throw new Error(`${name} must be a valid integer`);
  return value;
}

function optionalFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseFloat(raw);
  if (isNaN(value)) throw new Error(`${name} must be a valid number`);
  return value;
}

export const config = {
  botUrl: required("BOT_URL"),
  agentSecret: required("AGENT_SECRET"),
  pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 5000),
  skillDir: required("SKILL_DIR"),
  mcpGardenPath: required("MCP_GARDEN_PATH"),
  chatId: requiredInt("CHAT_ID"),
  latitude: optionalFloat("LATITUDE", 63.84),
  longitude: optionalFloat("LONGITUDE", 23.13),
};
