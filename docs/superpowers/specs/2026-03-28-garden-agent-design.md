# Garden Agent — Design Spec

## Overview

A Claude Agent SDK-powered gardening assistant that extends the existing Telegram bot (garden_bot on Fly.io) with AI capabilities. The bot remains self-sufficient; the agent is an optional add-on running on the user's Mac.

## Architecture

```
┌─────────────────┐         ┌─────────────────────┐
│  Telegram User   │         │   Mac (local)        │
│                  │         │                      │
│  text / photo    │         │  garden-agent/       │
└───────┬──────────┘         │  ├── polling.ts      │
        │                    │  ├── agent.ts        │
        ▼                    │  ├── proactive.ts    │
┌─────────────────┐  poll   │  └── config.ts       │
│  garden_bot      │◄───────│                      │
│  (Fly.io)        │        │  Agent SDK + query() │
│                  │ reply   │  Garden MCP (stdio)  │
│  Telegraf +      │◄───────│  Garden Skill files  │
│  Express +       │        │  ~/.claude/skills/   │
│  AgentQueue      │        │    garden/           │
└─────────────────┘         └─────────────────────┘
```

- **Bot (Fly.io):** Telegraf + Express. Handles bot commands, weather alerts, serves as Telegram gateway. Adds in-memory message queue + two API endpoints for agent communication.
- **Agent (Mac):** Standalone Node.js process. Polls bot for messages, processes via Agent SDK with Garden Skill + Garden MCP, sends replies back through bot.

## Bot Changes (Fly.io)

### New module: `src/services/agentQueueService.ts`

In-memory FIFO queue. Max 100 messages.

Message schema:
```typescript
interface AgentMessage {
  id: string;
  chatId: number;
  type: "text" | "photo";
  text?: string;
  photoBase64?: string;
  caption?: string;
  timestamp: number;
}
```

Tracks `lastAgentPoll: number` — timestamp of last poll from agent.

### Message routing in `commands.ts`

- `/start`, `/location`, `/threshold`, `/status`, `/toggle`, `/help` — bot handles directly (no change)
- Free text — enqueue for agent. Bot replies "✓" if agent online, "Запишу, отвечу когда агент будет доступен" if offline (lastAgentPoll > 5 min ago)
- Photo — bot downloads via `telegram.getFileLink()` + axios, converts to base64, enqueues with caption if present

### New API endpoints

**`GET /api/agent/messages?secret=XXX`**
- Returns array of queued messages
- Clears queue
- Updates `lastAgentPoll`
- 401 if secret invalid

**`POST /api/agent/reply`**
- Body: `{ secret, chatId, text, parseMode? }`
- Sends message via `bot.telegram.sendMessage()`
- `parseMode` defaults to `"MarkdownV2"`, optional override to `"HTML"` or `null`
- 401 if secret invalid

### Environment

New env variable: `AGENT_SECRET` — shared secret for API auth.

## Agent (Mac)

### New project: `garden-agent/`

```
garden-agent/
├── src/
│   ├── index.ts          — entry point, starts polling + cron
│   ├── polling.ts        — polling loop, message routing
│   ├── agent.ts          — Agent SDK wrapper (query config)
│   ├── proactive.ts      — cron-based proactive notifications
│   └── config.ts         — env: BOT_URL, AGENT_SECRET, POLL_INTERVAL
├── package.json
└── tsconfig.json
```

### Polling (`polling.ts`)

Every 5 seconds:
1. `GET BOT_URL/api/agent/messages?secret=XXX`
2. For each message → `processMessage()`
3. Response → `POST BOT_URL/api/agent/reply`

### Agent SDK call (`agent.ts`)

```typescript
query({
  prompt: userMessage,
  options: {
    systemPrompt: gardenSkillContent,   // SKILL.md content
    mcpServers: {
      "garden-mcp": {
        command: "node",
        args: ["/Users/lihachev/Projects/mcp-garden/dist/index.js"]
      }
    },
    allowedTools: ["Read", "Write", "mcp__garden-mcp__*"],
    cwd: "/Users/lihachev/.claude/skills/garden",
    maxTurns: 10,
    permissionMode: "acceptEdits"
  }
})
```

Working directory: `~/.claude/skills/garden/` — agent reads/writes plants.md, journal.md directly.

Photos: save base64 to temp file, pass path as image in prompt, delete after processing.

### Proactive notifications (`proactive.ts`)

**Morning check (08:00 daily):**
1. `query()` with prompt: "Check weather forecast, seasonal calendar, plant statuses. Report only critical items. Empty string if nothing urgent."
2. Agent uses MCP (`garden_check`, `get_frost_risk`) + reads plants.md
3. Non-empty response → `POST /api/agent/reply` to user

**Frost emergency check (every 4 hours):**
1. Direct MCP call to `get_frost_risk` — no LLM, no tokens
2. If `hard_frost: true` within 48 hours → alert via bot
3. Cheap check, runs even if LLM budget exhausted

**Spam filter:** Max one proactive message per day (except emergency frost alerts). Tracked in memory.

## Message Handling

| Scenario | Input | Agent action |
|----------|-------|-------------|
| Free question | text: "когда пикировать?" | `query()` with skill → text reply |
| Photo | photo base64 | Save tmp file, `query()` with image → ID/diagnosis, update plants.md + journal.md |
| Journal entry | text: "полил томаты" | `query()` → recognize intent, write journal.md, confirm |
| Plant status | text: "как перцы?" | `query()` → read plants.md, reply |
| Proactive | cron trigger | `query()` → analysis, notify if critical |

## Graceful Degradation

When agent is offline (Mac sleeping / agent not running):
- Bot fully functional: all commands, weather alerts, API endpoints unchanged
- Free text and photos queue up (max 100 messages)
- Bot tells user "агент офлайн"
- When agent starts: processes queue chronologically
- Messages older than 24 hours: agent skips, marks as stale
- Zero coupling: remove agentQueueService + endpoints → bot works as before

## Security and Limits

- Shared secret in env variables, checked on every request
- `maxTurns: 10` — prevents agent loops
- Agent writes only to `~/.claude/skills/garden/` — no system access
- `permissionMode: "acceptEdits"` — agent reads/writes garden files without confirmation
- Temp photo files deleted after processing
- Queue: 100 message limit, FIFO overflow protection
