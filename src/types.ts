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

export interface TimelineStage {
  name: string;
  start: string;
  end: string;
}

export interface TimelineEntry {
  plant: string;
  stages: TimelineStage[];
}

export interface CalendarEvent {
  date: string;
  type: string;
  title: string;
}

export interface DashboardData {
  timeline: TimelineEntry[];
  calendar: CalendarEvent[];
}

export interface TaskUpdate {
  taskLine: string;
  done: boolean;
  timestamp: number;
}
