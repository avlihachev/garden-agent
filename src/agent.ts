import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import { config } from "./config.js";
import { AgentMessage } from "./types.js";

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;

  const skillPath = join(config.skillDir, "SKILL.md");
  const profilePath = join(config.skillDir, "profile.md");

  const [skill, profile] = await Promise.all([
    readFile(skillPath, "utf-8"),
    readFile(profilePath, "utf-8").catch(() => ""),
  ]);

  systemPromptCache = profile
    ? `${skill}\n\n---\n\n# User Profile (preloaded)\n\n${profile}`
    : skill;

  return systemPromptCache;
}

const MAX_PHOTO_BASE64_LENGTH = 10 * 1024 * 1024; // ~7.5MB decoded

async function savePhoto(base64: string): Promise<string> {
  if (base64.length > MAX_PHOTO_BASE64_LENGTH) {
    throw new Error("Photo too large");
  }
  const filename = `garden-photo-${crypto.randomUUID()}.jpg`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, Buffer.from(base64, "base64"));
  return filepath;
}

async function runAgent(prompt: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();

  let result = "";
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      mcpServers: {
        "garden-mcp": {
          command: "node",
          args: [config.mcpGardenPath],
          env: {
            SKILL_DIR: config.skillDir,
            TASKS_FILE_PATH: config.tasksFilePath,
          },
        },
      },
      allowedTools: ["Read", "Write", "Glob", "Grep", "mcp__garden-mcp__*"],
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
      mcpServers: {
        "garden-mcp": {
          command: "node",
          args: [config.mcpGardenPath],
          env: {
            SKILL_DIR: config.skillDir,
            TASKS_FILE_PATH: config.tasksFilePath,
          },
        },
      },
      allowedTools: ["Read", "Glob", "Grep", "mcp__garden-mcp__*"],
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
