# Garden Agent — Conversation History, Task Sync & History Management

## Problem

1. **No conversation context** — each `query()` call is independent. User says "да" and agent doesn't know what they're agreeing to.
2. **No task awareness** — agent doesn't read the Obsidian task file before responding, creates duplicates, misses user updates.
3. **No history management** — conversations grow unbounded or are lost entirely.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format | JSON file (`history.json`) | No new dependencies, easy serialize/deserialize, sufficient for our volume |
| History placement | In user prompt (not system prompt) | System prompt stays cacheable (`SKILL.md + profile.md`) |
| Task sync trigger | New session (new day OR >1h pause) | Balances freshness vs token cost |
| Auto-rotation trigger | ~20K tokens (estimated as `text.length / 4`) | Handles variable message lengths better than message count |
| Rotation strategy | LLM summary → journal.md + previousContext, retain last ~5K tokens | Dual persistence: long-term in journal, short-term bridge in history |
| Manual clear | `/clear` command | User-initiated forced rotation with full summary |

## 1. History Storage

**File:** `~/.claude/skills/garden/history.json`

```json
{
  "previousContext": "Обсуждали пикировку чили, решили заглубить до семядолей. Обрезка крыжовника: убрать ветки 4+ лет, проредить центр.",
  "messages": [
    { "role": "user", "text": "а что с земляникой?", "timestamp": 1711700000000 },
    { "role": "assistant", "text": "Alexandria — посев поверхностный...", "timestamp": 1711700005000 }
  ],
  "lastSessionStart": 1711700000000
}
```

- `previousContext`: LLM-generated summary of rotated messages. `null` on first run.
- `messages`: chronological array of user/assistant pairs with timestamps.
- `lastSessionStart`: timestamp of last task file read (for session detection).

File created automatically on first message if missing. Loaded into memory at agent startup, saved after each exchange.

## 2. Prompt Assembly

System prompt unchanged: `SKILL.md + profile.md` (cached).

User prompt assembled per-query:

```
<previous_context>
Обсуждали пикировку чили, решили заглубить до семядолей.
</previous_context>

<conversation_history>
[user] а что с земляникой?
[assistant] Alexandria — посев поверхностный, не присыпать...
[user] посеял, что дальше?
[assistant] Накрыть плёнкой, 18-22°C, ждать 14-28 дней.
</conversation_history>

<current_tasks>
...contents of Задачи сад 2026.md...
</current_tasks>

<user_message>
да, давай пикируем чили
</user_message>
```

Sections included conditionally:
- `<previous_context>` — only if `previousContext !== null`
- `<conversation_history>` — only if `messages.length > 0`
- `<current_tasks>` — only on new session start
- `<user_message>` — always

## 3. Session Detection

A new session is detected when:

```
isNewSession = (now - lastSessionStart > 3_600_000) OR (dayOf(now) !== dayOf(lastSessionStart))
```

On new session:
1. Read task file directly from filesystem (`fs.readFile` on configured path)
2. Include contents in `<current_tasks>` block
3. Update `lastSessionStart` to current timestamp

Within a session: no automatic task injection. Agent can use `Read` tool to check task file if conversation turns to tasks.

## 4. Automatic Rotation

**Trigger:** before adding a new message, check total token estimate:

```typescript
const estimatedTokens = messages.reduce((sum, m) => sum + m.text.length / 4, 0);
if (estimatedTokens > 20_000) { rotate(); }
```

**Rotation process:**

1. Split messages: old (to summarize) and recent (to retain, last ~5K tokens).
2. Call `query()` with summarization prompt:
   ```
   Summarize this conversation. Extract: key decisions made, actions taken,
   important observations about plants, open questions. Max 500 words.
   Write in the language the user used.

   <conversation>
   ...old messages...
   </conversation>
   ```
   This query uses system prompt only (no skill tools needed), `maxTurns: 1`.
3. Append summary to `journal.md` under current date heading.
4. If `previousContext` already exists, concatenate: `previousContext = existingContext + "\n\n" + newSummary`. If the combined context exceeds ~2K tokens, re-summarize it with a single LLM call to keep it concise.
5. Replace `messages` with only the recent portion.
6. Save `history.json`.

## 5. Manual Clear (`/clear`)

User sends `/clear` in Telegram → arrives in queue as regular text message.

**Handling in polling.ts:**
1. Detect `/clear` command before passing to agent.
2. Run rotation on ALL messages (not just old ones).
3. Set `messages` to empty array.
4. Save `history.json`.
5. Reply: "История очищена, контекст сохранён в journal."

## 6. Task Sync

### Read before write (SKILL.md addition)

Add to SKILL.md task backend section:

```
Before writing to the tasks file, always Read it first to get the current state.
Append new tasks to the appropriate section. Never overwrite existing content.
Respect user's checkmarks ([x]), comments, and edits.
If a task already exists, do not create a duplicate.
```

### Write access for queryAgent

Current `queryAgent` allowedTools: `["Read", "Glob", "Grep", "mcp__garden-mcp__*"]`.

Change to: `["Read", "Write", "Glob", "Grep", "mcp__garden-mcp__*"]`.

This allows the agent to update tasks and journal when responding to user messages (not just during proactive runs).

## 7. File Changes

| File | Change |
|------|--------|
| `src/history.ts` | **New.** `HistoryService` class: `load()`, `save()`, `addMessage()`, `estimateTokens()`, `rotate()`, `clear()`, `buildPromptContext()`, `isNewSession()`, `readTasksFile()` |
| `src/agent.ts` | Import HistoryService. `queryAgent()` receives pre-built prompt with history context. Add `Write` to queryAgent allowedTools. New `summarizeConversation()` function for rotation. |
| `src/polling.ts` | Initialize HistoryService on start. Before `processMessage`: build prompt context (history + optional tasks). After response: save user message + assistant reply to history. Handle `/clear` command. |
| `src/config.ts` | New env vars: `HISTORY_TOKEN_LIMIT` (default 20000), `HISTORY_RETAIN_TOKENS` (default 5000), `SESSION_TIMEOUT_MS` (default 3600000), `TASKS_FILE_PATH` (path to Obsidian task file). |
| `src/types.ts` | New types: `HistoryEntry`, `HistoryData`. |
| `SKILL.md` | Add task sync rules (read before write, no duplicates, respect user edits). |
| `history.json` | **New.** Auto-created at `~/.claude/skills/garden/history.json`. |

## 8. Out of Scope

- Photos not stored in history (only text description: "user sent a photo" + agent's response)
- No search across history (journal.md is searchable via Grep if needed)
- No backups of history.json (journal.md serves as durable archive)
- No changes to garden_bot (Fly.io) — all changes in garden-agent only
- No changes to proactive.ts — morning/frost checks don't use conversation history
