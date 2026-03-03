# Agent Core - Autonomous AI Agent

## Overview
An autonomous AI agent similar to OpenClaw, controllable via Telegram, powered by OpenRouter (DeepSeek/Kimi models). Features a full web dashboard for monitoring, configuration, and credential management. Designed for VPS deployment.

## Architecture
- **Frontend**: React + Shadcn UI + Tailwind CSS (dark mode support)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **AI**: OpenRouter API (DeepSeek, Kimi, GPT, Claude, Gemini models)
- **Telegram**: node-telegram-bot-api for command interface
- **Encryption**: AES-256-GCM for credential storage
- **Tools**: Web scraping, code execution, HTTP requests, file ops, Puppeteer (VPS)

## Key Files

### Backend
- `server/agent/core.ts` - Main agent execution loop with multi-step reasoning
- `server/agent/prompt.ts` - AI system prompt (agent brain / personality)
- `server/agent/openrouter.ts` - OpenRouter API client with cost tracking
- `server/agent/tools.ts` - Tool registry (14 tools: web scrape, code exec, puppeteer, etc.)
- `server/telegram.ts` - Telegram bot interface with commands
- `server/routes.ts` - Dashboard API endpoints with Zod validation
- `server/storage.ts` - Database storage layer (DatabaseStorage)
- `server/db.ts` - PostgreSQL connection

### Frontend
- `client/src/App.tsx` - Main app with sidebar layout
- `client/src/components/app-sidebar.tsx` - Navigation sidebar
- `client/src/components/theme-toggle.tsx` - Dark/light mode toggle
- `client/src/pages/dashboard.tsx` - Overview stats and recent tasks
- `client/src/pages/tasks.tsx` - Task management (create, cancel, retry, delete)
- `client/src/pages/credentials.tsx` - Platform account management
- `client/src/pages/settings.tsx` - AI provider and Telegram configuration
- `client/src/pages/logs.tsx` - Execution log viewer

### Shared
- `shared/schema.ts` - Database models (tasks, taskLogs, credentials, agentSettings, users)

### Deployment
- `.env.example` - Environment variable template
- `ecosystem.config.cjs` - PM2 configuration for VPS
- `drizzle.config.ts` - Database migration config

## Database Schema
- `tasks` - Task queue with status, priority, retry count, cost tracking
- `task_logs` - Step-by-step execution logs per task
- `credentials` - Encrypted platform accounts (AES-256-GCM)
- `agent_settings` - Key-value configuration store
- `users` - User accounts
- `conversations` / `messages` - Chat history

## VPS Deployment
1. Push to GitHub
2. Clone on VPS: `git clone <repo-url>`
3. Copy `.env.example` to `.env` and fill in values
4. Install: `npm install`
5. Setup PostgreSQL and set DATABASE_URL
6. Push schema: `npx drizzle-kit push`
7. Build: `npm run build`
8. Run: `pm2 start ecosystem.config.cjs`
9. Dashboard at configured PORT (default 5001, avoids 3000/4000)

## Configuration
All configurable from dashboard Settings page or env vars:
- OpenRouter API key, base URL, model selection
- Telegram bot token and allowed users
- Port (via PORT env var)
