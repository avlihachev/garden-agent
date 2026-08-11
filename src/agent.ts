import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import sharp from "sharp";
import { config } from "./config.js";
import { AgentMessage } from "./types.js";
import { openDb } from "./state/db.js";
import { GardenStore } from "./state/store.js";
import { createGardenStateServer } from "./state/mcp.js";

export const store = new GardenStore(openDb(config.dbPath));

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;

  const skillPath = join(config.skillDir, "SKILL.md");
  const profilePath = join(config.skillDir, "profile.md");

  const [skill, profile] = await Promise.all([
    readFile(skillPath, "utf-8"),
    readFile(profilePath, "utf-8").catch(() => ""),
  ]);

  const toolNote = `\n\n---\n\n# Tool Instructions\n\nTo update garden prose files (plants.md care notes, journal, profile) use the MCP tool \`garden_write\` with file parameter: "plants", "journal", or "profile". Do NOT use Write or Edit tools — they are not available. Always Read the file first, then garden_write with full updated content.\n\nTasks and the plant registry live in a database, NOT in markdown. Whenever a task or a plant fact emerges from the conversation, call the garden-state tools (mcp__garden-state__*): tasks_list / task_add / task_update / task_note, plant_list / plant_add / plant_update / plant_log_event. Never write tasks into markdown files. The journal stays prose for narrative; per-plant facts go to plant_log_event.`;

  systemPromptCache = profile
    ? `${skill}\n\n---\n\n# User Profile (preloaded)\n\n${profile}${toolNote}`
    : `${skill}${toolNote}`;

  return systemPromptCache;
}

const MAX_PHOTO_BASE64_LENGTH = 10 * 1024 * 1024; // ~7.5MB decoded

async function savePhoto(base64: string): Promise<string> {
  if (base64.length > MAX_PHOTO_BASE64_LENGTH) {
    throw new Error("Photo too large");
  }
  const filename = `garden-photo-${crypto.randomUUID()}.jpg`;
  const filepath = join(tmpdir(), filename);
  const raw = Buffer.from(base64, "base64");
  const optimized = await sharp(raw)
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  await writeFile(filepath, optimized);
  return filepath;
}

async function runAgent(prompt: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();

  let result = "";
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      mcpServers: buildMcpServers(),
      allowedTools: buildAllowedTools(["Read", "Write", "Glob", "Grep"]),
      cwd: config.skillDir,
      maxTurns: 10,
      permissionMode: "acceptEdits",
    },
  })) {
    if ("result" in message) {
      result = message.result;
    }
  }

  return result;
}

function buildMcpServers() {
  return {
    "garden-mcp": {
      command: "node",
      args: [config.mcpGardenPath],
      env: { SKILL_DIR: config.skillDir },
    },
    "garden-state": createGardenStateServer(store),
  } as Record<string, any>;
}

function buildAllowedTools(base: string[]): string[] {
  return [...base, "mcp__garden-mcp__*", "mcp__garden-state__*"];
}

function logAgentMessage(message: any): void {
  switch (message.type) {
    case "assistant": {
      const content = message.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (block.type === "tool_use") {
          const input = JSON.stringify(block.input);
          const short = input.length > 120 ? input.slice(0, 120) + "…" : input;
          console.log(`  🔧 ${block.name}(${short})`);
        } else if (block.type === "text" && block.text) {
          const preview = block.text.slice(0, 150).replace(/\n/g, " ");
          console.log(`  💬 ${preview}${block.text.length > 150 ? "…" : ""}`);
        }
      }
      if (message.error) {
        console.log(`  ⚠️ assistant error: ${message.error}`);
      }
      break;
    }
    case "result":
      if (message.subtype === "success") {
        console.log(`  ✅ Done in ${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)}`);
      } else {
        console.log(`  ❌ ${message.subtype}: ${message.errors?.join(", ") || "unknown"}`);
      }
      break;
  }
}

async function queryAgent(fullPrompt: string, internalPrefix?: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();
  const wrappedPrompt = internalPrefix
    ? `${internalPrefix}\n\n${fullPrompt}`
    : fullPrompt;

  console.log("🤖 Agent processing...");
  let result = "";
  for await (const message of query({
    prompt: wrappedPrompt,
    options: {
      systemPrompt,
      mcpServers: buildMcpServers(),
      allowedTools: buildAllowedTools(["Read", "Glob", "Grep"]),
      cwd: config.skillDir,
      maxTurns: 10,
      permissionMode: "acceptEdits",
    },
  })) {
    logAgentMessage(message);
    if ("result" in message) {
      result = message.result;
    }
  }

  return result;
}

export async function summarizeConversation(conversationText: string): Promise<string> {
  const systemPrompt = "You are a helpful assistant that summarizes garden conversations.";

  let result = "";
  for await (const message of query({
    prompt: `Summarize this conversation. Extract: key decisions made, actions taken, important observations about plants, open questions. Be concise, max 500 words. Write in the same language the user used.\n\n<conversation>\n${conversationText}\n</conversation>`,
    options: {
      systemPrompt,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "acceptEdits",
    },
  })) {
    if ("result" in message) {
      result = message.result;
    }
  }

  return result;
}

export async function processMessage(msg: AgentMessage, promptContext?: string): Promise<string> {
  if (msg.type === "photo") {
    if (!msg.photoBase64) {
      return "Ошибка: фото не получено.";
    }
    let photoPath: string | null = null;
    try {
      photoPath = await savePhoto(msg.photoBase64).catch(() => null);
      if (!photoPath) {
        return "Ошибка: фото слишком большое.";
      }
      const caption = msg.caption || "No caption provided";
      const photoPrompt = promptContext || `<user_message>\n${caption}\n</user_message>`;
      return await queryAgent(
        photoPrompt,
        `User sent a photo. Read the image at ${photoPath} and analyze it. Their caption:`
      );
    } finally {
      if (photoPath) {
        await unlink(photoPath).catch(() => {});
      }
    }
  }

  if (!msg.text) {
    return "Ошибка: пустое сообщение.";
  }

  const prompt = promptContext || `<user_message>\n${msg.text}\n</user_message>`;
  return await queryAgent(prompt);
}

export { runAgent };
