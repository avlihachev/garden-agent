export interface AgentMessage {
  id: string;
  chatId: number;
  type: "text" | "photo";
  text?: string;
  photoBase64?: string;
  caption?: string;
  timestamp: number;
}

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
