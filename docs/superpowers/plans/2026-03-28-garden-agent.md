# Garden Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI gardening assistant to the existing Telegram bot via Claude Agent SDK, with the bot on Fly.io as gateway and the agent running locally on Mac.

**Architecture:** The bot gains an in-memory message queue and two API endpoints. A separate Node.js project (`garden-agent`) polls the bot for messages, processes them through Agent SDK with Garden Skill + Garden MCP, and sends replies back. Proactive notifications run on cron locally.

**Tech Stack:** TypeScript, Node.js, Telegraf (existing bot), Express (existing), `@anthropic-ai/claude-agent-sdk`, `node-cron`, `axios`

**Spec:** `docs/superpowers/specs/2026-03-28-garden-agent-design.md`

---

## File Structure

### Bot changes (garden_bot — existing repo)

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/types.ts` | Add `AgentMessage` interface |
| Modify | `src/config.ts` | Add optional `agentSecret` |
| Create | `src/services/agentQueueService.ts` | In-memory FIFO queue (max 100), lastAgentPoll tracking |
| Modify | `src/index.ts` | Add agent endpoints, photo handler, modify text fallback |
| Create | `tests/agentQueueService.test.ts` | Unit tests for queue |
| Modify | `package.json` | Add vitest dev dependency |

### Agent project (garden-agent — new repo at ~/Projects/garden-agent/)

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `package.json` | Dependencies: agent SDK, axios, node-cron, dotenv |
| Create | `tsconfig.json` | TypeScript config (ES2022, NodeNext) |
| Create | `src/config.ts` | Env vars: BOT_URL, AGENT_SECRET, POLL_INTERVAL, SKILL_DIR, CHAT_ID |
| Create | `src/types.ts` | AgentMessage type (mirrors bot), BotReply type |
| Create | `src/polling.ts` | Poll bot for messages, send replies |
| Create | `src/agent.ts` | Agent SDK wrapper — query() with skill + MCP |
| Create | `src/proactive.ts` | Morning check (LLM) + frost emergency (direct API) |
| Create | `src/index.ts` | Entry point — start polling + cron |
| Create | `.env.example` | Template for env vars |

---

## Part 1: Bot Changes

### Task 1: Add agent types and config

**Files:**
- Modify: `src/types.ts:9` (after UserData)
- Modify: `src/config.ts`

- [ ] **Step 1: Add AgentMessage interface to types.ts**

Append after the existing `OneCallResponse` interface at the end of `src/types.ts`:

```typescript
export interface AgentMessage {
  id: string;
  chatId: number;
  type: "text" | "photo";
  text?: string;
  photoBase64?: string;
  caption?: string;
  timestamp: number;
}
```

- [ ] **Step 2: Add agentSecret to config.ts**

The secret is optional — bot works without it, agent endpoints just won't be available.

Replace the full `src/config.ts` content with:

```typescript
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN!,
  weatherApiKey: process.env.WEATHER_API_KEY!,
  recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY!,
  checkInterval: '0 */4 * * *',
  agentSecret: process.env.AGENT_SECRET || '',
};

if (!config.botToken) {
  throw new Error('BOT_TOKEN is required');
}

if (!config.weatherApiKey) {
  throw new Error('WEATHER_API_KEY is required');
}

if (!config.recaptchaSecretKey) {
  throw new Error('RECAPTCHA_SECRET_KEY is required');
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lihachev/Projects/garden_bot && npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/config.ts
git commit -m "Add AgentMessage type and optional AGENT_SECRET config"
```

---

### Task 2: Create AgentQueueService with tests

**Files:**
- Create: `src/services/agentQueueService.ts`
- Create: `tests/agentQueueService.test.ts`
- Modify: `package.json` (add vitest)

- [ ] **Step 1: Add vitest**

```bash
cd /Users/lihachev/Projects/garden_bot && npm install --save-dev vitest
```

- [ ] **Step 2: Write failing tests**

Create `tests/agentQueueService.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { AgentQueueService } from "../src/services/agentQueueService";

describe("AgentQueueService", () => {
  let queue: AgentQueueService;

  beforeEach(() => {
    queue = new AgentQueueService();
  });

  it("enqueues and dequeues messages in FIFO order", () => {
    queue.enqueue({ chatId: 1, type: "text", text: "first" });
    queue.enqueue({ chatId: 1, type: "text", text: "second" });

    const messages = queue.dequeueAll();
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("first");
    expect(messages[1].text).toBe("second");
  });

  it("clears queue after dequeueAll", () => {
    queue.enqueue({ chatId: 1, type: "text", text: "hello" });
    queue.dequeueAll();

    const messages = queue.dequeueAll();
    expect(messages).toHaveLength(0);
  });

  it("assigns id and timestamp to enqueued messages", () => {
    queue.enqueue({ chatId: 1, type: "text", text: "test" });

    const messages = queue.dequeueAll();
    expect(messages[0].id).toBeDefined();
    expect(messages[0].timestamp).toBeGreaterThan(0);
  });

  it("enforces max 100 messages, drops oldest", () => {
    for (let i = 0; i < 110; i++) {
      queue.enqueue({ chatId: 1, type: "text", text: `msg-${i}` });
    }

    const messages = queue.dequeueAll();
    expect(messages).toHaveLength(100);
    expect(messages[0].text).toBe("msg-10");
    expect(messages[99].text).toBe("msg-109");
  });

  it("tracks agent online status based on poll time", () => {
    expect(queue.isAgentOnline()).toBe(false);

    queue.updateLastPoll();
    expect(queue.isAgentOnline()).toBe(true);
  });

  it("reports agent offline after 5 minutes", () => {
    queue.updateLastPoll();
    // simulate 6 minutes passing
    (queue as any).lastAgentPoll = Date.now() - 6 * 60 * 1000;
    expect(queue.isAgentOnline()).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/lihachev/Projects/garden_bot && npx vitest run tests/agentQueueService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement AgentQueueService**

Create `src/services/agentQueueService.ts`:

```typescript
import { AgentMessage } from "../types";
import crypto from "crypto";

type EnqueueInput = Omit<AgentMessage, "id" | "timestamp">;

const MAX_QUEUE_SIZE = 100;
const AGENT_ONLINE_TIMEOUT_MS = 5 * 60 * 1000;

export class AgentQueueService {
  private queue: AgentMessage[] = [];
  private lastAgentPoll: number = 0;

  enqueue(input: EnqueueInput): void {
    const message: AgentMessage = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    this.queue.push(message);

    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(this.queue.length - MAX_QUEUE_SIZE);
    }
  }

  dequeueAll(): AgentMessage[] {
    const messages = [...this.queue];
    this.queue = [];
    return messages;
  }

  updateLastPoll(): void {
    this.lastAgentPoll = Date.now();
  }

  isAgentOnline(): boolean {
    if (this.lastAgentPoll === 0) return false;
    return Date.now() - this.lastAgentPoll < AGENT_ONLINE_TIMEOUT_MS;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/lihachev/Projects/garden_bot && npx vitest run tests/agentQueueService.test.ts`
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/agentQueueService.ts tests/agentQueueService.test.ts package.json package-lock.json
git commit -m "Add AgentQueueService with in-memory FIFO queue"
```

---

### Task 3: Add agent API endpoints

**Files:**
- Modify: `src/index.ts:88` (after `app.use(express.json())`)

- [ ] **Step 1: Add agentQueue and agent endpoints to index.ts**

First, after `const commands = new BotCommands(...)` (line 27), add the queue:

```typescript
  const agentQueue = new AgentQueueService();
```

Then, after the line `app.use(express.json());` (line 88) and before the health check endpoint (line 91), add:

```typescript
  // Agent API endpoints
  if (config.agentSecret) {
    const checkSecret = (req: Request, res: Response): boolean => {
      const secret = req.query.secret || req.body?.secret;
      if (secret !== config.agentSecret) {
        res.status(401).json({ error: "Invalid secret" });
        return false;
      }
      return true;
    };

    app.get("/api/agent/messages", (req: Request, res: Response) => {
      if (!checkSecret(req, res)) return;
      agentQueue.updateLastPoll();
      const messages = agentQueue.dequeueAll();
      res.json({ messages });
    });

    app.post("/api/agent/reply", async (req: Request, res: Response) => {
      if (!checkSecret(req, res)) return;
      const { chatId, text, parseMode } = req.body;

      if (!chatId || !text) {
        res.status(400).json({ error: "chatId and text required" });
        return;
      }

      try {
        await bot.telegram.sendMessage(chatId, text, {
          parse_mode: parseMode === null ? undefined : (parseMode || "MarkdownV2"),
        });
        res.json({ ok: true });
      } catch (error) {
        console.error("Agent reply error:", error);
        res.status(500).json({ error: "Failed to send message" });
      }
    });

    console.log("🤖 Agent API endpoints enabled");
  }
```

Add the import at the top of `src/index.ts` (after existing imports):

```typescript
import { AgentQueueService } from "./services/agentQueueService";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lihachev/Projects/garden_bot && npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "Add agent API endpoints for message polling and reply"
```

---

### Task 4: Route free text and photos to agent queue

**Files:**
- Modify: `src/index.ts:40-48` (text handler)
- Modify: `src/index.ts` (add photo handler)

- [ ] **Step 1: Replace the free text handler in index.ts**

Replace the existing text handler (lines 40-48):

```typescript
  bot.on(message("text"), async (ctx) => {
    const chatId = ctx.chat.id;
    await logger.logUserAction(chatId, "unknown_text_message", {
      text: ctx.message.text,
    });
    await ctx.reply(
      "Use commands to configure the bot. Type /help for assistance."
    );
  });
```

With:

```typescript
  bot.on(message("text"), async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    await logger.logUserAction(chatId, "text_message", { text });

    if (config.agentSecret) {
      agentQueue.enqueue({ chatId, type: "text", text });
      if (agentQueue.isAgentOnline()) {
        await ctx.reply("✓");
      } else {
        await ctx.reply("Запишу, отвечу когда агент будет доступен.");
      }
    } else {
      await ctx.reply(
        "Use commands to configure the bot. Type /help for assistance."
      );
    }
  });
```

- [ ] **Step 2: Add photo handler after the text handler**

Add right after the text handler:

```typescript
  bot.on(message("photo"), async (ctx) => {
    const chatId = ctx.chat.id;
    await logger.logUserAction(chatId, "photo_message");

    if (!config.agentSecret) {
      await ctx.reply("Photo processing is not available.");
      return;
    }

    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const fileLink = await ctx.telegram.getFileLink(largest.file_id);

      const response = await axios.get(fileLink.href, {
        responseType: "arraybuffer",
      });
      const photoBase64 = Buffer.from(response.data).toString("base64");
      const caption = ctx.message.caption;

      agentQueue.enqueue({ chatId, type: "photo", photoBase64, caption });

      if (agentQueue.isAgentOnline()) {
        await ctx.reply("✓ Фото получено");
      } else {
        await ctx.reply("Фото сохранено, обработаю когда агент будет доступен.");
      }
    } catch (error) {
      console.error("Photo download error:", error);
      await ctx.reply("Ошибка при загрузке фото.");
    }
  });
```

Add the axios import at the top of `src/index.ts` (it's already a dependency):

```typescript
import axios from "axios";
```

- [ ] **Step 3: Verify agentQueue is declared before bot handlers**

The `const agentQueue = new AgentQueueService()` from Task 3 was placed after Express setup, but bot handlers need it. Move it to after `const commands = ...` (line 27), before bot command registrations. The queue always exists; endpoints are gated behind `config.agentSecret`.

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/lihachev/Projects/garden_bot && npm run typecheck`
Expected: no errors

- [ ] **Step 5: Run tests**

Run: `cd /Users/lihachev/Projects/garden_bot && npx vitest run`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "Route free text and photos to agent queue"
```

---

## Part 2: Agent Project

### Task 5: Scaffold garden-agent project

**Files:**
- Create: `~/Projects/garden-agent/package.json`
- Create: `~/Projects/garden-agent/tsconfig.json`
- Create: `~/Projects/garden-agent/.env.example`
- Create: `~/Projects/garden-agent/.gitignore`

- [ ] **Step 1: Create project directory and initialize git**

```bash
mkdir -p /Users/lihachev/Projects/garden-agent/src
cd /Users/lihachev/Projects/garden-agent
git init
```

- [ ] **Step 2: Create package.json**

Create `/Users/lihachev/Projects/garden-agent/package.json`:

```json
{
  "name": "garden-agent",
  "version": "0.1.0",
  "description": "AI gardening assistant — polls Telegram bot, processes via Claude Agent SDK",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `/Users/lihachev/Projects/garden-agent/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create .env.example**

Create `/Users/lihachev/Projects/garden-agent/.env.example`:

```
BOT_URL=https://garden-weather-bot.fly.dev
AGENT_SECRET=your-shared-secret-here
POLL_INTERVAL_MS=5000
SKILL_DIR=/Users/lihachev/.claude/skills/garden
MCP_GARDEN_PATH=/Users/lihachev/Projects/mcp-garden/dist/index.js
CHAT_ID=your-telegram-chat-id
```

- [ ] **Step 5: Create .gitignore**

Create `/Users/lihachev/Projects/garden-agent/.gitignore`:

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Install dependencies**

```bash
cd /Users/lihachev/Projects/garden-agent && npm install
```

- [ ] **Step 7: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add -A
git commit -m "Scaffold garden-agent project"
```

---

### Task 6: Create config and types modules

**Files:**
- Create: `src/config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Create config.ts**

Create `/Users/lihachev/Projects/garden-agent/src/config.ts`:

```typescript
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
```

- [ ] **Step 2: Create types.ts**

Create `/Users/lihachev/Projects/garden-agent/src/types.ts`:

```typescript
export interface AgentMessage {
  id: string;
  chatId: number;
  type: "text" | "photo";
  text?: string;
  photoBase64?: string;
  caption?: string;
  timestamp: number;
}

export interface BotReply {
  secret: string;
  chatId: number;
  text: string;
  parseMode?: "MarkdownV2" | "HTML" | null;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/config.ts src/types.ts
git commit -m "Add config and types modules"
```

---

### Task 7: Create polling module

**Files:**
- Create: `src/polling.ts`

- [ ] **Step 1: Create polling.ts**

Create `/Users/lihachev/Projects/garden-agent/src/polling.ts`:

```typescript
import axios from "axios";
import { config } from "./config.js";
import { AgentMessage } from "./types.js";
import { processMessage } from "./agent.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

async function fetchMessages(): Promise<AgentMessage[]> {
  const url = `${config.botUrl}/api/agent/messages?secret=${encodeURIComponent(config.agentSecret)}`;
  const response = await axios.get<{ messages: AgentMessage[] }>(url, {
    timeout: 10000,
  });
  return response.data.messages;
}

async function sendReply(chatId: number, text: string): Promise<void> {
  await axios.post(
    `${config.botUrl}/api/agent/reply`,
    { secret: config.agentSecret, chatId, text, parseMode: null },
    { timeout: 10000 }
  );
}

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
      console.error(`Error processing message ${msg.id}:`, error);
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/polling.ts
git commit -m "Add polling module — fetch messages from bot, route to agent"
```

---

### Task 8: Create Agent SDK wrapper

**Files:**
- Create: `src/agent.ts`

- [ ] **Step 1: Create agent.ts**

Create `/Users/lihachev/Projects/garden-agent/src/agent.ts`:

```typescript
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
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors (or only Agent SDK type issues if package types aren't perfect — these are acceptable)

- [ ] **Step 3: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/agent.ts
git commit -m "Add Agent SDK wrapper with skill prompt and MCP config"
```

---

### Task 9: Create proactive notifications

**Files:**
- Create: `src/proactive.ts`

- [ ] **Step 1: Create proactive.ts**

Create `/Users/lihachev/Projects/garden-agent/src/proactive.ts`:

```typescript
import cron from "node-cron";
import axios from "axios";
import { config } from "./config.js";
import { runAgent } from "./agent.js";

let lastProactiveDate: string = "";

async function sendReply(text: string): Promise<void> {
  await axios.post(
    `${config.botUrl}/api/agent/reply`,
    { secret: config.agentSecret, chatId: config.chatId, text, parseMode: null },
    { timeout: 10000 }
  );
}

async function morningCheck(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  if (lastProactiveDate === today) {
    console.log("⏭ Already sent proactive message today");
    return;
  }

  console.log("🌅 Running morning check...");
  try {
    const reply = await runAgent(
      "Check weather forecast for the next 7 days, seasonal calendar, and plant statuses. " +
      "Report ONLY critical items that need immediate attention: frost risk, overdue tasks, " +
      "or time-sensitive actions. If everything is fine, respond with exactly: OK"
    );

    if (reply && reply.trim() !== "OK") {
      await sendReply(reply);
      lastProactiveDate = today;
      console.log("📤 Morning check sent");
    } else {
      console.log("✅ Morning check: nothing critical");
    }
  } catch (error) {
    console.error("Morning check error:", error);
  }
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
}

async function frostCheck(): Promise<void> {
  console.log("❄️ Running frost check...");
  try {
    // direct Open-Meteo call — no LLM tokens
    const lat = 63.84;
    const lon = 23.13;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=2&timezone=auto`;

    const response = await axios.get<{ hourly: OpenMeteoHourly }>(url, {
      timeout: 10000,
    });
    const { time, temperature_2m } = response.data.hourly;

    let hardFrost = false;
    let minTemp = Infinity;
    let minTime = "";

    for (let i = 0; i < temperature_2m.length; i++) {
      if (temperature_2m[i] < minTemp) {
        minTemp = temperature_2m[i];
        minTime = time[i];
      }
      if (temperature_2m[i] <= -2) {
        hardFrost = true;
      }
    }

    if (hardFrost) {
      const msg = `🚨 FROST ALERT\n\nHard frost expected: ${minTemp}°C at ${minTime}\nProtect tender plants immediately!`;
      await sendReply(msg);
      console.log(`🚨 Frost alert sent: ${minTemp}°C at ${minTime}`);
    } else {
      console.log(`✅ No frost risk (min: ${minTemp}°C)`);
    }
  } catch (error) {
    console.error("Frost check error:", error);
  }
}

export function startProactive(): void {
  // morning check at 08:00
  cron.schedule("0 8 * * *", morningCheck);
  console.log("🌅 Morning check scheduled at 08:00");

  // frost check every 4 hours
  cron.schedule("0 */4 * * *", frostCheck);
  console.log("❄️ Frost check scheduled every 4 hours");
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/proactive.ts
git commit -m "Add proactive notifications — morning check and frost alerts"
```

---

### Task 10: Create entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create index.ts**

Create `/Users/lihachev/Projects/garden-agent/src/index.ts`:

```typescript
import { startPolling } from "./polling.js";
import { startProactive } from "./proactive.js";

console.log("🌱 Garden Agent starting...");

startPolling();
startProactive();

console.log("✅ Garden Agent running");
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Build**

Run: `cd /Users/lihachev/Projects/garden-agent && npm run build`
Expected: compiles to `dist/` without errors

- [ ] **Step 4: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/index.ts
git commit -m "Add entry point — start polling and proactive cron"
```

---

### Task 11: Integration test — bot endpoints

**Files:** none (manual testing)

- [ ] **Step 1: Set AGENT_SECRET locally on bot**

Add to `/Users/lihachev/Projects/garden_bot/.env`:

```
AGENT_SECRET=test-secret-123
```

- [ ] **Step 2: Start the bot locally**

```bash
cd /Users/lihachev/Projects/garden_bot && npm run dev
```

- [ ] **Step 3: Test GET /api/agent/messages**

In a separate terminal:

```bash
curl -s "http://localhost:3000/api/agent/messages?secret=test-secret-123" | jq
```

Expected: `{ "messages": [] }`

- [ ] **Step 4: Test unauthorized access**

```bash
curl -s "http://localhost:3000/api/agent/messages?secret=wrong" | jq
```

Expected: `{ "error": "Invalid secret" }` with 401 status

- [ ] **Step 5: Test POST /api/agent/reply**

```bash
curl -s -X POST "http://localhost:3000/api/agent/reply" \
  -H "Content-Type: application/json" \
  -d '{"secret":"test-secret-123","chatId":YOUR_CHAT_ID,"text":"Test from agent","parseMode":null}' | jq
```

Expected: `{ "ok": true }` and message received in Telegram

- [ ] **Step 6: Stop bot**

Ctrl+C in the bot terminal.

---

### Task 12: Integration test — full agent flow

**Files:** none (manual testing)

- [ ] **Step 1: Create .env for agent**

Create `/Users/lihachev/Projects/garden-agent/.env`:

```
BOT_URL=https://garden-weather-bot.fly.dev
AGENT_SECRET=<same secret as on fly.io>
POLL_INTERVAL_MS=5000
SKILL_DIR=/Users/lihachev/.claude/skills/garden
MCP_GARDEN_PATH=/Users/lihachev/Projects/mcp-garden/dist/index.js
CHAT_ID=<your telegram chat id>
```

- [ ] **Step 2: Deploy bot with AGENT_SECRET to Fly.io**

```bash
cd /Users/lihachev/Projects/garden_bot
npm run build
flyctl secrets set AGENT_SECRET="<your-secret>"
flyctl deploy
```

- [ ] **Step 3: Start the agent locally**

```bash
cd /Users/lihachev/Projects/garden-agent && npm run dev
```

- [ ] **Step 4: Send a test message via Telegram**

Send "Как дела у томатов?" to the bot in Telegram.

Expected:
1. Bot replies "✓"
2. Agent picks up message within 5 seconds
3. Agent processes via Agent SDK (reads plants.md)
4. Agent sends reply back through bot
5. You receive a detailed answer about tomato status in Telegram

- [ ] **Step 5: Send a test photo via Telegram**

Send a photo of a plant to the bot.

Expected:
1. Bot replies "✓ Фото получено"
2. Agent downloads photo, saves to temp, processes via Agent SDK
3. Agent identifies the plant and sends reply via bot

- [ ] **Step 6: Stop agent, verify graceful degradation**

Stop the agent (Ctrl+C). Wait 6 minutes. Send a message to the bot.

Expected: Bot replies "Запишу, отвечу когда агент будет доступен."
