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
