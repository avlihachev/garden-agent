import { readFile } from "fs/promises";
import { join } from "path";
import { config } from "./config.js";
import { processMessage, summarizeConversation, computeTimeline } from "./agent.js";
import { fetchMessages, sendReply, syncGardenData } from "./botApi.js";
import { HistoryService } from "./history.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const history = new HistoryService(
  join(config.skillDir, "history.json")
);

let historyLoaded = false;

async function ensureHistoryLoaded(): Promise<void> {
  if (!historyLoaded) {
    await history.load();
    historyLoaded = true;
  }
}

async function readTasksFile(): Promise<string | null> {
  if (!config.tasksFilePath) return null;
  try {
    return await readFile(config.tasksFilePath, "utf-8");
  } catch {
    return null;
  }
}

async function handleClear(chatId: number): Promise<void> {
  const journalPath = join(config.skillDir, "journal.md");
  await history.clear(summarizeConversation, journalPath);
  await sendReply(chatId, "История очищена, контекст сохранён в journal.");
}

async function maybeRotate(): Promise<void> {
  if (history.estimateTokens() > config.historyTokenLimit) {
    console.log("🔄 Rotating conversation history...");
    const journalPath = join(config.skillDir, "journal.md");
    await history.rotate(
      config.historyRetainTokens,
      summarizeConversation,
      journalPath
    );
    console.log("✅ History rotated");
  }
}

async function pollOnce(): Promise<void> {
  const messages = await fetchMessages();
  if (messages.length === 0) return;

  await ensureHistoryLoaded();
  console.log(`📨 Received ${messages.length} message(s)`);

  for (const msg of messages) {
    const age = Date.now() - msg.timestamp;
    if (age > STALE_THRESHOLD_MS) {
      console.log(`⏭ Skipping stale message ${msg.id} (${Math.round(age / 3600000)}h old)`);
      continue;
    }

    // handle /clear command
    if (msg.type === "text" && msg.text?.trim() === "/clear") {
      try {
        await handleClear(msg.chatId);
      } catch (error) {
        console.error("Clear error:", error instanceof Error ? error.message : error);
        await sendReply(msg.chatId, "Ошибка при очистке истории.");
      }
      continue;
    }

    try {
      // check for rotation before processing
      await maybeRotate();

      // check if new session — load tasks
      let currentTasks: string | null = null;
      if (history.isNewSession(config.sessionTimeoutMs)) {
        currentTasks = await readTasksFile();
        history.data.lastSessionStart = Date.now();
        console.log("📋 New session — tasks loaded");
      }

      // build prompt with history context
      const userText = msg.type === "photo"
        ? (msg.caption || "Photo sent")
        : (msg.text || "");
      const promptContext = history.buildPromptContext(userText, currentTasks);

      // process message
      const reply = await processMessage(msg, promptContext);

      if (reply) {
        await sendReply(msg.chatId, reply);

        // save after successful delivery
        history.addMessage("user", userText);
        history.addMessage("assistant", reply);
        await history.save();

        // sync garden data to bot dashboard (with timeline)
        computeTimeline()
          .then((dashboard) => syncGardenData(dashboard))
          .catch(() => {});
      }
    } catch (error) {
      console.error(`Error processing message ${msg.id}:`, error instanceof Error ? error.message : error);
      await sendReply(msg.chatId, "Произошла ошибка при обработке сообщения.");
    }
  }
}

export function startPolling(): void {
  console.log(`🔄 Polling every ${config.pollIntervalMs}ms`);

  // initial sync on startup (with timeline)
  computeTimeline()
    .then((dashboard) => syncGardenData(dashboard))
    .catch(() => {});

  const poll = async () => {
    try {
      await pollOnce();
    } catch (error: unknown) {
      const code = error instanceof Error ? (error as any).code : undefined;
      if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNABORTED") {
        // bot unreachable — silent retry
      } else {
        console.error("Poll error:", error instanceof Error ? error.message : String(error));
      }
    }
  };

  const loop = async () => {
    await poll();
    setTimeout(loop, config.pollIntervalMs);
  };
  loop();
}
