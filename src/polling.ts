import { config } from "./config.js";
import { processMessage } from "./agent.js";
import { fetchMessages, sendReply } from "./botApi.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

async function pollOnce(): Promise<void> {
  const messages = await fetchMessages();
  if (messages.length === 0) return;

  console.log(`📨 Received ${messages.length} message(s)`);

  for (const msg of messages) {
    const age = Date.now() - msg.timestamp;
    if (age > STALE_THRESHOLD_MS) {
      console.log(`⏭ Skipping stale message ${msg.id} (${Math.round(age / 3600000)}h old)`);
      continue;
    }

    try {
      const reply = await processMessage(msg);
      if (reply) {
        await sendReply(msg.chatId, reply);
      }
    } catch (error) {
      console.error(`Error processing message ${msg.id}:`, error instanceof Error ? error.message : error);
      await sendReply(msg.chatId, "Произошла ошибка при обработке сообщения.");
    }
  }
}

export function startPolling(): void {
  console.log(`🔄 Polling every ${config.pollIntervalMs}ms`);

  const poll = async () => {
    try {
      await pollOnce();
    } catch (error: any) {
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        // bot unreachable — silent retry
      } else {
        console.error("Poll error:", error.message);
      }
    }
  };

  poll();
  setInterval(poll, config.pollIntervalMs);
}
