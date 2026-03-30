import axios from "axios";
import { config } from "./config.js";
import { AgentMessage } from "./types.js";

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
