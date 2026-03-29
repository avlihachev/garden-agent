# CLAUDE.md

## Project Overview

AI gardening assistant that extends the Telegram bot (garden_bot on Fly.io) with Claude Agent SDK capabilities. Runs locally on Mac, polls the bot for user messages, processes them through the garden skill + MCP, and sends replies back.

## Architecture

```
Telegram → garden_bot (Fly.io) ←polling→ garden-agent (Mac)
                                              ├── Agent SDK + query()
                                              ├── Garden Skill (SKILL.md)
                                              └── Garden MCP (stdio)
```

- **Bot** (avlihachev/garden_bot, Fly.io) — self-sufficient Telegram gateway with in-memory message queue
- **Agent** (this project, local Mac) — polls bot via HTTP, processes messages through Agent SDK
- Communication: polling-based, Authorization Bearer header, timing-safe secret comparison
- Bot works fully without agent (graceful degradation)

## Module Responsibilities

| File | Role |
|------|------|
| `src/index.ts` | Entry point — starts polling + proactive cron |
| `src/config.ts` | Env var loading with validation |
| `src/types.ts` | AgentMessage and BotReply interfaces |
| `src/botApi.ts` | HTTP client for bot endpoints (fetchMessages, sendReply) |
| `src/polling.ts` | Poll loop — fetch messages, route to agent, send replies |
| `src/agent.ts` | Agent SDK wrapper — query() with garden skill as system prompt + MCP |
| `src/proactive.ts` | Cron jobs: morning check (LLM) + frost emergency (direct Open-Meteo API) |

## Key Design Decisions

- **System prompt** = SKILL.md + profile.md concatenated (prevents onboarding prompt on first call)
- **Working directory** = `~/.claude/skills/garden/` — agent reads/writes plants.md, journal.md directly
- **MCP server** = garden-mcp at ~/Projects/mcp-garden/ connected via stdio
- **parseMode: null** on replies — safe choice to avoid MarkdownV2 escaping issues
- **Stale messages** (>24h) are skipped by the agent
- **Frost check** calls Open-Meteo directly (no LLM tokens), max one alert per day
- **Morning check** uses Agent SDK (LLM), max one proactive message per day

## Environment Variables

Required in `.env` (see `.env.example`):
- `BOT_URL` — Fly.io bot URL (https://garden-weather-bot.fly.dev)
- `AGENT_SECRET` — shared secret, must match bot's AGENT_SECRET
- `SKILL_DIR` — path to garden skill (~/.claude/skills/garden)
- `MCP_GARDEN_PATH` — path to MCP server dist (~/Projects/mcp-garden/dist/index.js)
- `CHAT_ID` — Telegram chat ID for proactive notifications

Optional:
- `POLL_INTERVAL_MS` — polling interval, default 5000
- `LATITUDE` / `LONGITUDE` — for frost checks, default Kokkola (63.84, 23.13)

## Commands

- `npm run dev` — start in development mode (tsx)
- `npm run build` — compile TypeScript
- `npm start` — run production build
- `npm run typecheck` — type checking

## Related Projects

- **garden_bot** (~/Projects/garden_bot) — Telegram bot on Fly.io, gateway for this agent
- **mcp-garden** (~/Projects/mcp-garden) — MCP server providing weather/soil/daylight data
- **garden skill** (~/.claude/skills/garden/) — gardening assistant skill with plants.md, journal.md, profile.md
