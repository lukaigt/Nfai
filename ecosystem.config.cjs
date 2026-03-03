module.exports = {
  apps: [{
    name: "agent-core",
    script: "npm",
    args: "start",
    cwd: __dirname,
    env: {
      NODE_ENV: "production",
      PORT: "5001",
    },
    watch: false,
    max_memory_restart: "500M",
    restart_delay: 5000,
    max_restarts: 10,
  }]
};
