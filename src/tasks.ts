import { readFile, writeFile } from "fs/promises";

export async function applyTaskUpdate(
  filePath: string,
  taskLine: string,
  done: boolean
): Promise<boolean> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const target = taskLine.trim();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== target) continue;

    if (done && lines[i].includes("- [ ]")) {
      lines[i] = lines[i].replace("- [ ]", "- [x]");
      await writeFile(filePath, lines.join("\n"), "utf-8");
      return true;
    }
    if (!done && lines[i].includes("- [x]")) {
      lines[i] = lines[i].replace("- [x]", "- [ ]");
      await writeFile(filePath, lines.join("\n"), "utf-8");
      return true;
    }
    return false;
  }

  console.warn("Task line not found in file:", target.slice(0, 60));
  return false;
}
