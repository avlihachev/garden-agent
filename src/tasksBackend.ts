import { readFile, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export async function readTasks(): Promise<string | null> {
  if (config.tasksBackend === "bear") {
    return readTasksBear();
  }
  return readTasksObsidian();
}

export async function applyTaskUpdate(taskLine: string, done: boolean): Promise<boolean> {
  if (config.tasksBackend === "bear") {
    return applyTaskUpdateBear(taskLine, done);
  }
  return applyTaskUpdateObsidian(taskLine, done);
}

async function readTasksObsidian(): Promise<string | null> {
  if (!config.tasksFilePath) return null;
  try {
    return await readFile(config.tasksFilePath, "utf-8");
  } catch {
    return null;
  }
}

async function applyTaskUpdateObsidian(taskLine: string, done: boolean): Promise<boolean> {
  if (!config.tasksFilePath) return false;
  const content = await readFile(config.tasksFilePath, "utf-8");
  const lines = content.split("\n");
  const target = taskLine.trim();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== target) continue;
    if (done && lines[i].includes("- [ ]")) {
      lines[i] = lines[i].replace("- [ ]", "- [x]");
      await writeFile(config.tasksFilePath, lines.join("\n"), "utf-8");
      return true;
    }
    if (!done && lines[i].includes("- [x]")) {
      lines[i] = lines[i].replace("- [x]", "- [ ]");
      await writeFile(config.tasksFilePath, lines.join("\n"), "utf-8");
      return true;
    }
    return false;
  }
  console.warn("Task line not found in file:", target.slice(0, 60));
  return false;
}

function bearAddressArgs(): string[] {
  return config.tasksBearId
    ? [config.tasksBearId]
    : ["--title", config.tasksBearTitle];
}

async function readTasksBear(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      config.bearcliPath,
      ["cat", ...bearAddressArgs()],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout || null;
  } catch (err) {
    console.warn("Bear read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function applyTaskUpdateBear(taskLine: string, done: boolean): Promise<boolean> {
  const target = taskLine.trim();
  let from: string;
  let to: string;
  if (done) {
    if (!target.startsWith("- [ ]")) return false;
    from = target;
    to = target.replace("- [ ]", "- [x]");
  } else {
    if (!target.startsWith("- [x]")) return false;
    from = target;
    to = target.replace("- [x]", "- [ ]");
  }

  try {
    await execFileAsync(config.bearcliPath, [
      "edit",
      ...bearAddressArgs(),
      "--at", from,
      "--replace", to,
    ]);
    return true;
  } catch (err) {
    console.warn("Bear edit failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
