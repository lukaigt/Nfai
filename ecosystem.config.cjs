module.exports = {
  apps: [{
    name: "agent-core",
    script: "dist/index.cjs",
    cwd: __dirname,
    env: {
      NODE_ENV: "production",
    },
    watch: false,
    max_memory_restart: "500M",
    restart_delay: 5000,
    max_restarts: 10,
  }]
};
