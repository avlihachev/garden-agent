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
    const journalEntry = `\n### Conversation summary\n${summary}\n`;
    const journalContent = await readFile(journalPath, "utf-8").catch(() => "");
    if (journalContent.includes(`## ${today}`)) {
      const updated = journalContent.replace(
        `## ${today}`,
        `## ${today}\n${journalEntry}`
      );
      await writeFile(journalPath, updated);
    } else {
      const header = journalContent ? "\n" : "";
      const dateBlock = `${header}## ${today}\n${journalEntry}`;
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

  async clear(
    summarize: (text: string) => Promise<string>,
    journalPath: string,
  ): Promise<void> {
    await this.rotate(0, summarize, journalPath);
  }
}
