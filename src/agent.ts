import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import sharp from "sharp";
import { config } from "./config.js";
import { AgentMessage, DashboardData } from "./types.js";

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;

  const skillPath = join(config.skillDir, "SKILL.md");
  const profilePath = join(config.skillDir, "profile.md");

  const [skill, profile] = await Promise.all([
    readFile(skillPath, "utf-8"),
    readFile(profilePath, "utf-8").catch(() => ""),
  ]);

  const toolNote = `\n\n---\n\n# Tool Instructions\n\nTo update garden files use the MCP tool \`garden_write\` with file parameter: "plants", "journal", "profile", or "tasks". Do NOT use Write or Edit tools — they are not available. Always Read the file first, then garden_write with full updated content.`;

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

const TIMELINE_PROMPT = `You are given garden data files. Produce a JSON object with two arrays:

1. "timeline" — for each seasonal plant (skip houseplants, trees, perennial herbs that don't have a sowing-to-harvest cycle this year), create an entry with growing stages. Each stage has a name ("indoor", "hardening", "outdoor", "harvest"), start date, and end date (ISO format YYYY-MM-DD).

Rules for computing dates:
- Use profile.md last_frost_date and the seasonal formulas below
- Use journal.md entries for ACTUAL dates (if a plant was sown on a specific date, use that as the indoor start)
- For future stages, compute from formulas
- "indoor" = sowing indoors until hardening begins
- "hardening" = 2 weeks before transplant
- "outdoor" = transplant until harvest begins
- "harvest" = estimated harvest period
- Skip stages that don't apply (e.g. radish has no indoor stage)

Seasonal formulas (relative to last_frost_date):
- Peppers/chili indoor sow: last_frost - 10..12 weeks
- Tomatoes (determinate) indoor sow: last_frost - 8..10 weeks
- Alpine strawberry indoor sow: last_frost - 10..12 weeks
- Tender crops transplant: last_frost + 1..2 weeks
- Hardy crops transplant: last_frost - 2..4 weeks
- Direct sow radish/lettuce: last_frost - 4..6 weeks
- Hardening start: transplant_date - 14 days

2. "calendar" — frost risk events and key planned dates:
- Frost risk: any day in the next 7 days where min temp ≤ 0°C (from weather data if available)
- Planned dates: upcoming transplant dates, sowing windows, harvest starts from the timeline

Return ONLY valid JSON, no markdown fences, no explanation. Example format:
{"timeline":[{"plant":"Tomato — Balkonzauber","stages":[{"name":"indoor","start":"2026-02-15","end":"2026-05-20"},{"name":"hardening","start":"2026-05-20","end":"2026-06-03"},{"name":"outdoor","start":"2026-06-03","end":"2026-08-01"},{"name":"harvest","start":"2026-08-01","end":"2026-09-15"}]}],"calendar":[{"date":"2026-04-15","type":"frost","title":"Frost risk -2°C"},{"date":"2026-06-03","type":"planned","title":"Transplant tomatoes outdoors"}]}`;

export async function computeTimeline(): Promise<DashboardData | null> {
  try {
    const [plants, journal, profile] = await Promise.all([
      readFile(join(config.skillDir, "plants.md"), "utf-8").catch(() => ""),
      readFile(join(config.skillDir, "journal.md"), "utf-8").catch(() => ""),
      readFile(join(config.skillDir, "profile.md"), "utf-8").catch(() => ""),
    ]);

    if (!plants && !journal) return null;

    const today = new Date().toISOString().split("T")[0];
    const prompt = `${TIMELINE_PROMPT}\n\nToday's date: ${today}\n\n<plants>\n${plants}\n</plants>\n\n<journal>\n${journal}\n</journal>\n\n<profile>\n${profile}\n</profile>`;

    let result = "";
    for await (const message of query({
      prompt,
      options: {
        systemPrompt: "You are a garden data processor. Output only valid JSON.",
        maxTurns: 1,
        allowedTools: [],
        permissionMode: "acceptEdits",
      },
    })) {
      if ("result" in message) {
        result = message.result;
      }
    }

    const cleaned = result.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as DashboardData;

    if (!Array.isArray(parsed.timeline) || !Array.isArray(parsed.calendar)) {
      console.error("Invalid timeline response structure");
      return null;
    }

    console.log(`📊 Timeline: ${parsed.timeline.length} plants, ${parsed.calendar.length} events`);
    return parsed;
  } catch (error) {
    console.error("Timeline computation failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export { runAgent };
