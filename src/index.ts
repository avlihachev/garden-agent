import { startPolling } from "./polling.js";
import { startProactive } from "./proactive.js";

console.log("🌱 Garden Agent starting...");

startPolling();
startProactive();

console.log("✅ Garden Agent running");
