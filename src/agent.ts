import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import { config } from "./config.js";
import { AgentMessage } from "./types.js";

let skillPrompt: string | null = null;

async function getSkillPrompt(): Promise<string> {
  if (skillPrompt) return skillPrompt;
  const skillPath = join(config.skillDir, "SKILL.md");
  skillPrompt = await readFile(skillPath, "utf-8");
  return skillPrompt;
}

async function savePhoto(base64: string): Promise<string> {
  const filename = `garden-photo-${crypto.randomUUID()}.jpg`;
  const filepath = join(tmpdir(), filename);
  await writeFile(filepath, Buffer.from(base64, "base64"));
  return filepath;
}

async function runAgent(prompt: string): Promise<string> {
  const systemPrompt = await getSkillPrompt();

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

export async function processMessage(msg: AgentMessage): Promise<string> {
  if (msg.type === "photo") {
    let photoPath: string | null = null;
    try {
      photoPath = await savePhoto(msg.photoBase64!);
      const prompt = msg.caption
        ? `User sent a photo with caption: "${msg.caption}". Read the image at ${photoPath} and analyze it.`
        : `User sent a photo. Read the image at ${photoPath} and analyze it.`;
      return await runAgent(prompt);
    } finally {
      if (photoPath) {
        await unlink(photoPath).catch(() => {});
      }
    }
  }

  return await runAgent(msg.text!);
}

export { runAgent };
