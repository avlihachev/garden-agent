# Conversation History, Task Sync & History Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent conversation history with automatic rotation, task file synchronization, and manual clear to garden-agent.

**Architecture:** New `HistoryService` manages a JSON file (`history.json`) storing conversation messages and summary context. Before each `query()`, a prompt is assembled with history + optional task file contents. Rotation uses a separate LLM call to summarize old messages into `journal.md` and a `previousContext` bridge.

**Tech Stack:** TypeScript, Node.js, Claude Agent SDK, vitest for tests, fs/promises for persistence.

**Spec:** `docs/superpowers/specs/2026-03-29-conversation-history-design.md`

---

### Task 1: Set up test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/__tests__/history.test.ts`

- [ ] **Step 1: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Create empty test file to verify setup**

```typescript
// src/__tests__/history.test.ts
import { describe, it, expect } from "vitest";

describe("HistoryService", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify vitest works**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: 1 test passes

- [ ] **Step 4: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add vitest.config.ts src/__tests__/history.test.ts
git commit -m "chore: add vitest config and test scaffold"
```

---

### Task 2: Add types and config for history

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Write failing test for types**

Add to `src/__tests__/history.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { HistoryEntry, HistoryData } from "../types.js";

describe("History types", () => {
  it("HistoryEntry has required fields", () => {
    const entry: HistoryEntry = {
      role: "user",
      text: "hello",
      timestamp: Date.now(),
    };
    expect(entry.role).toBe("user");
    expect(entry.text).toBe("hello");
    expect(typeof entry.timestamp).toBe("number");
  });

  it("HistoryData has required fields", () => {
    const data: HistoryData = {
      previousContext: null,
      messages: [],
      lastSessionStart: 0,
    };
    expect(data.previousContext).toBeNull();
    expect(data.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: FAIL — `HistoryEntry` and `HistoryData` not exported from `types.ts`

- [ ] **Step 3: Add types to types.ts**

Add to the end of `src/types.ts`:

```typescript
export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface HistoryData {
  previousContext: string | null;
  messages: HistoryEntry[];
  lastSessionStart: number;
}
```

- [ ] **Step 4: Add config values to config.ts**

Add three new fields to the `config` export in `src/config.ts`:

```typescript
  historyTokenLimit: optionalInt("HISTORY_TOKEN_LIMIT", 20000),
  historyRetainTokens: optionalInt("HISTORY_RETAIN_TOKENS", 5000),
  sessionTimeoutMs: optionalInt("SESSION_TIMEOUT_MS", 3600000),
  tasksFilePath: process.env.TASKS_FILE_PATH || "",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: all tests pass

- [ ] **Step 6: Typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/types.ts src/config.ts src/__tests__/history.test.ts
git commit -m "feat: add history types and config"
```

---

### Task 3: Implement HistoryService — load, save, add, estimate tokens

**Files:**
- Create: `src/history.ts`
- Modify: `src/__tests__/history.test.ts`

- [ ] **Step 1: Write failing tests for core HistoryService methods**

Replace `src/__tests__/history.test.ts` entirely:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import type { HistoryEntry, HistoryData } from "../types.js";
import { HistoryService } from "../history.js";

function tmpDir(): string {
  return join(tmpdir(), `garden-test-${crypto.randomUUID()}`);
}

describe("HistoryService", () => {
  let dir: string;
  let svc: HistoryService;

  beforeEach(async () => {
    dir = tmpDir();
    await mkdir(dir, { recursive: true });
    svc = new HistoryService(join(dir, "history.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("returns empty data when file does not exist", async () => {
      await svc.load();
      expect(svc.data.messages).toEqual([]);
      expect(svc.data.previousContext).toBeNull();
      expect(svc.data.lastSessionStart).toBe(0);
    });

    it("loads existing file", async () => {
      const existing: HistoryData = {
        previousContext: "some context",
        messages: [{ role: "user", text: "hi", timestamp: 1000 }],
        lastSessionStart: 1000,
      };
      const filePath = join(dir, "history.json");
      const { writeFile } = await import("fs/promises");
      await writeFile(filePath, JSON.stringify(existing));

      await svc.load();
      expect(svc.data.previousContext).toBe("some context");
      expect(svc.data.messages).toHaveLength(1);
    });
  });

  describe("save", () => {
    it("persists data to file", async () => {
      await svc.load();
      svc.addMessage("user", "hello");
      await svc.save();

      const raw = await readFile(join(dir, "history.json"), "utf-8");
      const parsed = JSON.parse(raw) as HistoryData;
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0].text).toBe("hello");
    });
  });

  describe("addMessage", () => {
    it("appends a message", async () => {
      await svc.load();
      svc.addMessage("user", "hi");
      svc.addMessage("assistant", "hello");
      expect(svc.data.messages).toHaveLength(2);
      expect(svc.data.messages[0].role).toBe("user");
      expect(svc.data.messages[1].role).toBe("assistant");
    });

    it("sets timestamp", async () => {
      await svc.load();
      const before = Date.now();
      svc.addMessage("user", "test");
      const after = Date.now();
      expect(svc.data.messages[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(svc.data.messages[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("estimateTokens", () => {
    it("returns 0 for empty history", async () => {
      await svc.load();
      expect(svc.estimateTokens()).toBe(0);
    });

    it("estimates based on text length / 4", async () => {
      await svc.load();
      svc.addMessage("user", "a".repeat(400)); // 100 tokens
      svc.addMessage("assistant", "b".repeat(800)); // 200 tokens
      expect(svc.estimateTokens()).toBe(300);
    });
  });

  describe("isNewSession", () => {
    it("returns true when lastSessionStart is 0", async () => {
      await svc.load();
      expect(svc.isNewSession(3600000)).toBe(true);
    });

    it("returns true after timeout", async () => {
      await svc.load();
      svc.data.lastSessionStart = Date.now() - 3600001;
      expect(svc.isNewSession(3600000)).toBe(true);
    });

    it("returns false within timeout on same day", async () => {
      await svc.load();
      svc.data.lastSessionStart = Date.now() - 1000;
      expect(svc.isNewSession(3600000)).toBe(false);
    });

    it("returns true on new calendar day even within timeout", async () => {
      await svc.load();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 0, 0);
      svc.data.lastSessionStart = yesterday.getTime();
      expect(svc.isNewSession(86400000)).toBe(true); // huge timeout but different day
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: FAIL — cannot import `HistoryService` from `../history.js`

- [ ] **Step 3: Implement HistoryService**

Create `src/history.ts`:

```typescript
import { readFile, writeFile } from "fs/promises";
import type { HistoryData, HistoryEntry } from "./types.js";

const EMPTY_DATA: HistoryData = {
  previousContext: null,
  messages: [],
  lastSessionStart: 0,
};

export class HistoryService {
  data: HistoryData = { ...EMPTY_DATA, messages: [] };

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.data = JSON.parse(raw) as HistoryData;
    } catch {
      this.data = { ...EMPTY_DATA, messages: [] };
    }
  }

  async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  addMessage(role: HistoryEntry["role"], text: string): void {
    this.data.messages.push({ role, text, timestamp: Date.now() });
  }

  estimateTokens(): number {
    return this.data.messages.reduce(
      (sum, m) => sum + Math.ceil(m.text.length / 4),
      0
    );
  }

  isNewSession(timeoutMs: number): boolean {
    const now = Date.now();
    const last = this.data.lastSessionStart;
    if (last === 0) return true;
    if (now - last > timeoutMs) return true;

    const nowDate = new Date(now).toDateString();
    const lastDate = new Date(last).toDateString();
    return nowDate !== lastDate;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: all tests pass

- [ ] **Step 5: Typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/history.ts src/__tests__/history.test.ts
git commit -m "feat: implement HistoryService core (load/save/add/estimate/session)"
```

---

### Task 4: Implement prompt builder

**Files:**
- Modify: `src/history.ts`
- Modify: `src/__tests__/history.test.ts`

- [ ] **Step 1: Write failing tests for buildPromptContext**

Add to `src/__tests__/history.test.ts` inside the main `describe("HistoryService")` block:

```typescript
  describe("buildPromptContext", () => {
    it("returns just user_message for empty history", async () => {
      await svc.load();
      const result = svc.buildPromptContext("hello", null);
      expect(result).toBe("<user_message>\nhello\n</user_message>");
    });

    it("includes conversation_history when messages exist", async () => {
      await svc.load();
      svc.addMessage("user", "first");
      svc.addMessage("assistant", "reply");
      const result = svc.buildPromptContext("second", null);
      expect(result).toContain("<conversation_history>");
      expect(result).toContain("[user] first");
      expect(result).toContain("[assistant] reply");
      expect(result).toContain("</conversation_history>");
      expect(result).toContain("<user_message>\nsecond\n</user_message>");
    });

    it("includes previous_context when set", async () => {
      await svc.load();
      svc.data.previousContext = "summary of old chat";
      const result = svc.buildPromptContext("hi", null);
      expect(result).toContain("<previous_context>");
      expect(result).toContain("summary of old chat");
      expect(result).toContain("</previous_context>");
    });

    it("includes current_tasks when provided", async () => {
      await svc.load();
      const tasks = "- [ ] Water tomatoes\n- [x] Prune apple";
      const result = svc.buildPromptContext("what's next?", tasks);
      expect(result).toContain("<current_tasks>");
      expect(result).toContain("Water tomatoes");
      expect(result).toContain("</current_tasks>");
    });

    it("omits empty sections", async () => {
      await svc.load();
      const result = svc.buildPromptContext("hi", null);
      expect(result).not.toContain("<previous_context>");
      expect(result).not.toContain("<conversation_history>");
      expect(result).not.toContain("<current_tasks>");
    });

    it("preserves section order: context, history, tasks, message", async () => {
      await svc.load();
      svc.data.previousContext = "ctx";
      svc.addMessage("user", "old");
      svc.addMessage("assistant", "old reply");
      const tasks = "task list";
      const result = svc.buildPromptContext("new msg", tasks);

      const ctxIdx = result.indexOf("<previous_context>");
      const histIdx = result.indexOf("<conversation_history>");
      const taskIdx = result.indexOf("<current_tasks>");
      const msgIdx = result.indexOf("<user_message>");

      expect(ctxIdx).toBeLessThan(histIdx);
      expect(histIdx).toBeLessThan(taskIdx);
      expect(taskIdx).toBeLessThan(msgIdx);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: FAIL — `svc.buildPromptContext is not a function`

- [ ] **Step 3: Implement buildPromptContext**

Add to `src/history.ts` inside the `HistoryService` class:

```typescript
  buildPromptContext(userMessage: string, currentTasks: string | null): string {
    const parts: string[] = [];

    if (this.data.previousContext) {
      parts.push(
        `<previous_context>\n${this.data.previousContext}\n</previous_context>`
      );
    }

    if (this.data.messages.length > 0) {
      const lines = this.data.messages.map(
        (m) => `[${m.role}] ${m.text}`
      );
      parts.push(
        `<conversation_history>\n${lines.join("\n")}\n</conversation_history>`
      );
    }

    if (currentTasks) {
      parts.push(`<current_tasks>\n${currentTasks}\n</current_tasks>`);
    }

    parts.push(`<user_message>\n${userMessage}\n</user_message>`);

    return parts.join("\n\n");
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/history.ts src/__tests__/history.test.ts
git commit -m "feat: add prompt builder with context/history/tasks/message sections"
```

---

### Task 5: Implement rotation logic

**Files:**
- Modify: `src/history.ts`
- Modify: `src/__tests__/history.test.ts`

- [ ] **Step 1: Write failing tests for splitMessages and rotation helpers**

Add to `src/__tests__/history.test.ts` inside the main `describe("HistoryService")` block:

```typescript
  describe("splitForRotation", () => {
    it("splits messages keeping retainTokens worth at the end", async () => {
      await svc.load();
      // each message: 40 chars = 10 tokens
      for (let i = 0; i < 10; i++) {
        svc.addMessage("user", "x".repeat(40));
        svc.addMessage("assistant", "y".repeat(40));
      }
      // total: 20 messages * 10 tokens = 200 tokens
      // retain 50 tokens = last 5 messages
      const [old, recent] = svc.splitForRotation(50);
      expect(recent.length).toBe(5);
      expect(old.length).toBe(15);
    });

    it("returns all messages as old when retain is 0", async () => {
      await svc.load();
      svc.addMessage("user", "a".repeat(40));
      svc.addMessage("assistant", "b".repeat(40));
      const [old, recent] = svc.splitForRotation(0);
      expect(old.length).toBe(2);
      expect(recent.length).toBe(0);
    });
  });

  describe("formatForSummary", () => {
    it("formats messages as conversation text", async () => {
      await svc.load();
      const messages: HistoryEntry[] = [
        { role: "user", text: "how is chili?", timestamp: 1000 },
        { role: "assistant", text: "needs pricking out", timestamp: 2000 },
      ];
      const result = HistoryService.formatForSummary(messages);
      expect(result).toContain("[user] how is chili?");
      expect(result).toContain("[assistant] needs pricking out");
    });
  });
```

Import `HistoryEntry` at top if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: FAIL — `svc.splitForRotation is not a function`

- [ ] **Step 3: Implement splitForRotation and formatForSummary**

Add to `HistoryService` class in `src/history.ts`:

```typescript
  splitForRotation(retainTokens: number): [HistoryEntry[], HistoryEntry[]] {
    if (retainTokens <= 0) {
      return [this.data.messages.slice(), []];
    }

    let retainCount = 0;
    let tokenCount = 0;
    for (let i = this.data.messages.length - 1; i >= 0; i--) {
      tokenCount += Math.ceil(this.data.messages[i].text.length / 4);
      if (tokenCount > retainTokens) break;
      retainCount++;
    }

    const splitIdx = this.data.messages.length - retainCount;
    return [
      this.data.messages.slice(0, splitIdx),
      this.data.messages.slice(splitIdx),
    ];
  }

  static formatForSummary(messages: HistoryEntry[]): string {
    return messages.map((m) => `[${m.role}] ${m.text}`).join("\n");
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/history.ts src/__tests__/history.test.ts
git commit -m "feat: add rotation split and summary formatting"
```

---

### Task 6: Implement full rotation with LLM summarization

**Files:**
- Modify: `src/history.ts`
- Modify: `src/agent.ts`

This task connects rotation to the LLM for summarization and appends to journal.md. Testing is done via integration test in Task 8.

- [ ] **Step 1: Add summarizeConversation to agent.ts**

Add this exported function to `src/agent.ts` (after the existing `queryAgent` function, before `processMessage`):

```typescript
export async function summarizeConversation(conversationText: string): Promise<string> {
  const systemPrompt = "You are a helpful assistant that summarizes garden conversations.";

  let result = "";
  for await (const message of query({
    prompt: `Summarize this conversation. Extract: key decisions made, actions taken, important observations about plants, open questions. Be concise, max 500 words. Write in the same language the user used.\n\n<conversation>\n${conversationText}\n</conversation>`,
    options: {
      systemPrompt,
      maxTurns: 1,
      permissionMode: "acceptEdits",
    },
  })) {
    if ("result" in message) {
      result = message.result;
    }
  }

  return result;
}
```

- [ ] **Step 2: Add rotate method to HistoryService**

Add method to `HistoryService` class:

```typescript
  async rotate(
    retainTokens: number,
    summarize: (text: string) => Promise<string>,
    journalPath: string,
  ): Promise<void> {
    if (this.data.messages.length === 0) return;

    const [old, recent] = this.splitForRotation(retainTokens);
    if (old.length === 0) return;

    const conversationText = HistoryService.formatForSummary(old);
    const summary = await summarize(conversationText);

    // append to journal.md
    const today = new Date().toISOString().split("T")[0];
    const journalEntry = `\n### Conversation summary\n- ${summary}\n`;
    const journalContent = await readFile(journalPath, "utf-8").catch(() => "");
    if (journalContent.includes(`## ${today}`)) {
      // append under existing date heading
      const updated = journalContent.replace(
        `## ${today}`,
        `## ${today}\n${journalEntry}`
      );
      await writeFile(journalPath, updated);
    } else {
      // add new date heading
      const header = journalContent ? "\n" : "";
      const dateBlock = `${header}## ${today}\n${journalEntry}`;
      // insert after first line (# Garden Journal) or at top
      const firstNewline = journalContent.indexOf("\n");
      if (firstNewline > 0) {
        const updated =
          journalContent.slice(0, firstNewline + 1) +
          "\n" +
          dateBlock +
          journalContent.slice(firstNewline + 1);
        await writeFile(journalPath, updated);
      } else {
        await writeFile(journalPath, journalContent + dateBlock);
      }
    }

    // update previousContext
    if (this.data.previousContext) {
      const combined = this.data.previousContext + "\n\n" + summary;
      if (combined.length / 4 > 2000) {
        this.data.previousContext = await summarize(
          `Condense this context into a shorter summary:\n\n${combined}`
        );
      } else {
        this.data.previousContext = combined;
      }
    } else {
      this.data.previousContext = summary;
    }

    this.data.messages = recent;
    await this.save();
  }
```

- [ ] **Step 3: Add clear method to HistoryService**

Add to `HistoryService` class in `src/history.ts`:

```typescript
  async clear(
    summarize: (text: string) => Promise<string>,
    journalPath: string,
  ): Promise<void> {
    await this.rotate(0, summarize, journalPath);
    this.data.messages = [];
    await this.save();
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run existing tests to verify nothing broke**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: all tests still pass

- [ ] **Step 6: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/history.ts src/agent.ts
git commit -m "feat: add rotation with LLM summarization and journal append"
```

---

### Task 7: Integrate history into agent.ts

**Files:**
- Modify: `src/agent.ts`

- [ ] **Step 1: Update queryAgent to accept pre-built prompt**

Change the `queryAgent` function signature and body in `src/agent.ts`. The function now receives the full prompt (already assembled by HistoryService) instead of raw user input:

Replace the entire `queryAgent` function:

```typescript
async function queryAgent(fullPrompt: string, internalPrefix?: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();
  const wrappedPrompt = internalPrefix
    ? `${internalPrefix}\n\n${fullPrompt}`
    : fullPrompt;

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
```

Note two changes vs original:
1. Parameter renamed from `userInput` to `fullPrompt` — prompt is now pre-assembled with history context
2. `allowedTools` now includes `"Write"` (was missing before)

- [ ] **Step 2: Update processMessage to accept prompt context**

Replace the `processMessage` function:

```typescript
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
      // for photos, promptContext already contains history; caption is the user_message part
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

  // for text: promptContext already has history + user_message wrapped
  const prompt = promptContext || `<user_message>\n${msg.text}\n</user_message>`;
  return await queryAgent(prompt);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/agent.ts
git commit -m "feat: integrate history context into queryAgent and processMessage"
```

---

### Task 8: Integrate history into polling.ts

**Files:**
- Modify: `src/polling.ts`

- [ ] **Step 1: Rewrite polling.ts with history lifecycle**

Replace the entire content of `src/polling.ts`:

```typescript
import { readFile } from "fs/promises";
import { join } from "path";
import { config } from "./config.js";
import { processMessage, summarizeConversation } from "./agent.js";
import { fetchMessages, sendReply } from "./botApi.js";
import { HistoryService } from "./history.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const history = new HistoryService(
  join(config.skillDir, "history.json")
);

let historyLoaded = false;

async function ensureHistoryLoaded(): Promise<void> {
  if (!historyLoaded) {
    await history.load();
    historyLoaded = true;
  }
}

async function readTasksFile(): Promise<string | null> {
  if (!config.tasksFilePath) return null;
  try {
    return await readFile(config.tasksFilePath, "utf-8");
  } catch {
    return null;
  }
}

async function handleClear(chatId: number): Promise<void> {
  const journalPath = join(config.skillDir, "journal.md");
  await history.clear(summarizeConversation, journalPath);
  await sendReply(chatId, "История очищена, контекст сохранён в journal.");
}

async function maybeRotate(): Promise<void> {
  if (history.estimateTokens() > config.historyTokenLimit) {
    console.log("🔄 Rotating conversation history...");
    const journalPath = join(config.skillDir, "journal.md");
    await history.rotate(
      config.historyRetainTokens,
      summarizeConversation,
      journalPath
    );
    console.log("✅ History rotated");
  }
}

async function pollOnce(): Promise<void> {
  const messages = await fetchMessages();
  if (messages.length === 0) return;

  await ensureHistoryLoaded();
  console.log(`📨 Received ${messages.length} message(s)`);

  for (const msg of messages) {
    const age = Date.now() - msg.timestamp;
    if (age > STALE_THRESHOLD_MS) {
      console.log(`⏭ Skipping stale message ${msg.id} (${Math.round(age / 3600000)}h old)`);
      continue;
    }

    // handle /clear command
    if (msg.type === "text" && msg.text?.trim() === "/clear") {
      try {
        await handleClear(msg.chatId);
      } catch (error) {
        console.error("Clear error:", error instanceof Error ? error.message : error);
        await sendReply(msg.chatId, "Ошибка при очистке истории.");
      }
      continue;
    }

    try {
      // check for rotation before processing
      await maybeRotate();

      // check if new session — load tasks
      let currentTasks: string | null = null;
      if (history.isNewSession(config.sessionTimeoutMs)) {
        currentTasks = await readTasksFile();
        history.data.lastSessionStart = Date.now();
        console.log("📋 New session — tasks loaded");
      }

      // build prompt with history context
      const userText = msg.type === "photo"
        ? (msg.caption || "Photo sent")
        : (msg.text || "");
      const promptContext = history.buildPromptContext(userText, currentTasks);

      // process message
      const reply = await processMessage(msg, promptContext);

      if (reply) {
        // save exchange to history
        history.addMessage("user", userText);
        history.addMessage("assistant", reply);
        await history.save();

        await sendReply(msg.chatId, reply);
      }
    } catch (error) {
      console.error(`Error processing message ${msg.id}:`, error instanceof Error ? error.message : error);
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
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || error.code === "ECONNABORTED") {
        // bot unreachable — silent retry
      } else {
        console.error("Poll error:", error.message);
      }
    }
  };

  const loop = async () => {
    await poll();
    setTimeout(loop, config.pollIntervalMs);
  };
  loop();
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add src/polling.ts
git commit -m "feat: integrate history lifecycle into polling loop"
```

---

### Task 9: Update SKILL.md with task sync rules

**Files:**
- Modify: `~/.claude/skills/garden/SKILL.md`

- [ ] **Step 1: Add task sync rules to SKILL.md**

Find the "Common rules (all backends)" section in `~/.claude/skills/garden/SKILL.md` (around line 286). Add these rules to the end of that section:

```markdown
- Before writing to the tasks file, always Read it first to get the current state
- Append new tasks to the appropriate section — never overwrite existing content
- Respect user's checkmarks ([x]), comments, and manual edits
- If a task already exists (same action + same crop), do not create a duplicate
```

- [ ] **Step 2: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add ~/.claude/skills/garden/SKILL.md
git commit -m "docs: add task sync rules to SKILL.md"
```

---

### Task 10: Add TASKS_FILE_PATH to .env and documentation

**Files:**
- Modify: `/Users/lihachev/Projects/garden-agent/.env` (add new var)
- Modify: `/Users/lihachev/Projects/garden-agent/CLAUDE.md` (if exists) or `README.md`

- [ ] **Step 1: Add TASKS_FILE_PATH to .env**

Add this line to the `.env` file:

```
TASKS_FILE_PATH=/Users/lihachev/obsidian/Hus/Garden/Задачи сад 2026.md
```

- [ ] **Step 2: Update CLAUDE.md with new env vars**

Check if CLAUDE.md exists. If so, add to the environment section:

```markdown
- `HISTORY_TOKEN_LIMIT` - Max tokens before auto-rotation (default: 20000)
- `HISTORY_RETAIN_TOKENS` - Tokens to keep after rotation (default: 5000)
- `SESSION_TIMEOUT_MS` - New session threshold in ms (default: 3600000 = 1 hour)
- `TASKS_FILE_PATH` - Path to Obsidian tasks markdown file
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lihachev/Projects/garden-agent
git add .env CLAUDE.md
git commit -m "docs: add history and task sync config"
```

---

### Task 11: Build and manual smoke test

- [ ] **Step 1: Run all tests**

Run: `cd /Users/lihachev/Projects/garden-agent && npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Typecheck**

Run: `cd /Users/lihachev/Projects/garden-agent && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Build**

Run: `cd /Users/lihachev/Projects/garden-agent && npm run build`
Expected: compiles without errors

- [ ] **Step 4: Verify history.json is created on first run**

Run the agent briefly with `npm run dev`, send a test message via Telegram, verify:
1. `~/.claude/skills/garden/history.json` is created
2. It contains the message exchange
3. Reply includes conversation context

- [ ] **Step 5: Test /clear command**

Send `/clear` via Telegram, verify:
1. Bot replies "История очищена, контекст сохранён в journal."
2. `history.json` has empty messages array
3. `journal.md` has a new conversation summary entry

- [ ] **Step 6: Test session detection**

Wait >1 hour (or temporarily set `SESSION_TIMEOUT_MS=5000` in .env), send a message, verify:
1. Console log shows "📋 New session — tasks loaded"
2. Agent's response is aware of current task state
