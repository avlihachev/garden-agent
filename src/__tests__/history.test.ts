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
      expect(svc.isNewSession(86400000)).toBe(true);
    });
  });

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
});
