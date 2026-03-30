module.exports = {
  apps: [{
    name: "garden-agent",
    script: "dist/index.js",
    cwd: "/Users/lihachev/Projects/garden-agent",
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 5000,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
  }],
};
