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
