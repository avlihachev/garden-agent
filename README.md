# garden-agent

AI gardening assistant powered by [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents). Polls a Telegram bot for messages, processes them through a gardening skill with MCP tools, and sends replies back.

## Architecture

```
Telegram → garden_bot (Fly.io) ←polling→ garden-agent (local)
                                              ├── Claude Agent SDK
                                              ├── Garden Skill (SKILL.md)
                                              └── Garden MCP (weather, soil, daylight)
```

- **Bot** — Telegram gateway with message queue, deployed on Fly.io
- **Agent** (this project) — polls bot via HTTP, processes messages through Claude Agent SDK
- **MCP server** — provides weather forecasts, frost risk, soil data, daylight info via [mcp-garden](https://github.com/avlihachev/mcp-garden)

The bot works independently without the agent (graceful degradation). The agent adds AI capabilities on top.

## Features

- Natural language gardening advice based on your location, plants, and conditions
- Conversation history with automatic rotation and summarization
- Photo analysis (plant identification, health assessment)
- Proactive morning checks with weather-based recommendations
- Frost alerts via Open-Meteo API (no LLM tokens)
- Task tracking integration (Obsidian, Linear, OmniFocus)
- Restricted file writes via `garden_write` MCP tool (least privilege)

## Prerequisites

- Node.js 20+
- A running instance of [garden_bot](https://github.com/avlihachev/garden_bot) (Telegram gateway)
- [mcp-garden](https://github.com/avlihachev/mcp-garden) built locally
- Claude Code or Anthropic API access (for Agent SDK)

## Setup

```bash
git clone https://github.com/avlihachev/garden-agent.git
cd garden-agent
npm install
cp .env.example .env
# Edit .env with your values
npm run build
```

## Configuration

Required environment variables (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `BOT_URL` | URL of your garden_bot instance |
| `AGENT_SECRET` | Shared secret (must match bot's AGENT_SECRET) |
| `SKILL_DIR` | Path to garden skill directory |
| `MCP_GARDEN_PATH` | Path to mcp-garden `dist/index.js` |
| `CHAT_ID` | Telegram chat ID for proactive notifications |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | 5000 | Polling interval in ms |
| `LATITUDE` / `LONGITUDE` | 63.84 / 23.13 | Location for weather/frost checks |
| `HISTORY_TOKEN_LIMIT` | 20000 | Max tokens before history rotation |
| `SESSION_TIMEOUT_MS` | 3600000 | New session threshold (1 hour) |
| `TASKS_FILE_PATH` | — | Path to Obsidian tasks file |

## Running

Development:
```bash
npm run dev
```

Production (with pm2):
```bash
npm run build
pm2 start ecosystem.config.cjs
```

## Related Projects

- [garden_bot](https://github.com/avlihachev/garden_bot) — Telegram bot gateway
- [mcp-garden](https://github.com/avlihachev/mcp-garden) — MCP server for weather/soil/daylight data

## License

MIT
