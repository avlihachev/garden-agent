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

async function savePhoto(base64: string): Promise<string> {
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

async function queryAgent(userInput: string, internalPrefix?: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();
  const wrappedPrompt = internalPrefix
    ? `${internalPrefix}\n\n<user_message>\n${userInput}\n</user_message>`
    : `<user_message>\n${userInput}\n</user_message>`;

  let result = "";
  for await (const message of query({
    prompt: wrappedPrompt,
    options: {
      systemPrompt,
      mcpServers: {
        "garden-mcp": {
          command: "node",
          args: [config.mcpGardenPath],
        },
      },
      allowedTools: ["Read", "Glob", "Grep", "mcp__garden-mcp__*"],
      cwd: config.skillDir,
      maxTurns: 10,
      permissionMode: "default",
    },
  })) {
    if ("result" in message) {
      result = message.result;
    }
  }

  return result;
}

export async function processMessage(msg: AgentMessage): Promise<string> {
  if (msg.type === "photo") {
    if (!msg.photoBase64) {
      return "Ошибка: фото не получено.";
    }
    let photoPath: string | null = null;
    try {
      photoPath = await savePhoto(msg.photoBase64);
      const caption = msg.caption || "No caption provided";
      return await queryAgent(caption, `User sent a photo. Read the image at ${photoPath} and analyze it. Their caption:`);
    } finally {
      if (photoPath) {
        await unlink(photoPath).catch(() => {});
      }
    }
  }

  if (!msg.text) {
    return "Ошибка: пустое сообщение.";
  }

  return await queryAgent(msg.text);
}

export { runAgent };
