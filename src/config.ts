import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  botUrl: required("BOT_URL"),
  agentSecret: required("AGENT_SECRET"),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
  skillDir: required("SKILL_DIR"),
  mcpGardenPath: required("MCP_GARDEN_PATH"),
  chatId: parseInt(required("CHAT_ID"), 10),
};
