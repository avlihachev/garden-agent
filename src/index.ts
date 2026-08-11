import { startPolling } from "./polling.js";
import { startProactive } from "./proactive.js";
import { startDashboard } from "./dashboard/server.js";
import { store } from "./agent.js";
import { config } from "./config.js";

console.log("🌱 Garden Agent starting...");

startPolling();
startProactive();

startDashboard(store, config.dashboardPort)
  .then(() => console.log(`📊 Dashboard: http://localhost:${config.dashboardPort}`))
  .catch(err => console.error("Dashboard failed to start:", err.message));

console.log("✅ Garden Agent running");
