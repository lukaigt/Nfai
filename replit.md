# Agent Core - Autonomous AI Agent (OpenClaw-style)

## Overview
An autonomous AI agent inspired by OpenClaw architecture, controllable via Telegram, powered by OpenRouter (DeepSeek/Kimi models). Features unified conversation sessions, long-term keyword-searchable memory, heartbeat scheduling, context compaction, and a web dashboard. Designed for VPS deployment.

## Architecture
- **Frontend**: React + Shadcn UI + Tailwind CSS (dark mode support)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **AI**: OpenRouter API (DeepSeek, Kimi, GPT, Claude, Gemini models)
- **Telegram**: node-telegram-bot-api — unified conversational session
- **Encryption**: AES-256-GCM for credential storage
- **Tools**: run_command (120s/5MB), web_scrape (structured text), execute_code (60s), http_request (form+JSON, status+headers), search_web (8 results w/ snippets), get_credentials (clear errors), file_write/read, save_memory, wait, install_package

## Key Design Decisions (OpenClaw-aligned)
- **Unified session**: No separate "chat mode" vs "task mode" — one continuous conversation per chat. Conversation context flows into task execution
- **Memory with search**: BM25-style keyword search over structured memory entries. Relevant memories injected per-task
- **Context compaction**: When conversation exceeds 30 messages, old messages are AI-summarized (600 chars per message for detail preservation). Summary preserves credentials, URLs, file paths, and technical details
- **Heartbeat scheduling**: Recurring tasks via `scheduled_tasks` table, checked every 60s. Real progress callbacks sent to Telegram
- **Autonomous prompt**: Agent is fundamentally resourceful:
  - Always uses web login with credentials (requests.Session + cookies), never asks for API keys
  - Searches the web BEFORE trying new platforms (self-teaching)
  - Has concrete worked examples (Reddit login, unknown website, info gathering)
  - Has recovery patterns for common errors (403, CAPTCHA, login failures, missing modules)
  - Tries 3+ approaches before reporting failure
- **Execution loop hardening**:
  - 50 max steps (up from 30)
  - Stuck detection: same tool+args called 3+ times → forces different approach
  - API-key interception: if agent asks for API keys → auto-corrects to web login
  - Failed approach tracking: all failures recorded and passed to agent to avoid repetition
  - Remaining step counter shown to agent for urgency
- **Chat resilience**: If AI returns plain text instead of JSON → used as chat reply (never crashes). All errors logged.
- **No fake tools**: All 11 tools are fully functional with real implementations

## Key Files

### Backend
- `server/agent/core.ts` - Agent execution loop (50 steps, stuck detection, API-key interception, failed approach tracking, compaction)
- `server/agent/prompt.ts` - Autonomous system prompt with worked examples and recovery patterns
- `server/agent/openrouter.ts` - OpenRouter API client with cost tracking
- `server/agent/tools.ts` - 11 real tools (run_command 120s/5MB, http_request with form data, search_web with snippets, web_scrape with structure, get_credentials with clear errors)
- `server/agent/memory.ts` - Long-term memory with BM25 keyword search
- `server/agent/heartbeat.ts` - Scheduled task runner (60s loop, real progress callbacks, error notifications to Telegram)
- `server/agent/session.ts` - JSONL-based session persistence (survives restarts, auto-archive on /reset)
- `server/telegram.ts` - Telegram bot: resilient chat (never crashes on non-JSON), plan→confirm→execute, scheduling, memory commands, sentence-boundary truncation
- `server/routes.ts` - Dashboard API endpoints
- `server/storage.ts` - Database storage layer (DatabaseStorage)
- `server/db.ts` - PostgreSQL connection

### Frontend
- `client/src/App.tsx` - Main app with sidebar layout
- `client/src/pages/dashboard.tsx` - Overview stats and recent tasks
- `client/src/pages/tasks.tsx` - Task management
- `client/src/pages/credentials.tsx` - Platform account management
- `client/src/pages/settings.tsx` - AI provider and Telegram configuration
- `client/src/pages/logs.tsx` - Execution log viewer

### Shared
- `shared/schema.ts` - Database models (tasks, taskLogs, credentials, agentSettings, agentMemories, scheduledTasks, users)

### Deployment
- `ecosystem.config.cjs` - PM2 configuration for VPS
- `drizzle.config.ts` - Database migration config

## Database Schema
- `tasks` - Task queue with status, priority, retry count, cost tracking
- `task_logs` - Step-by-step execution logs per task
- `credentials` - Encrypted platform accounts (AES-256-GCM)
- `agent_settings` - Key-value configuration store
- `agent_memories` - Long-term searchable memory entries (content, source, tags, hash)
- `scheduled_tasks` - Recurring tasks (description, intervalMinutes, nextRunAt, activeHours)
- `users` - User accounts

## VPS Deployment
1. Push to GitHub
2. On VPS: `cd /nfai && git stash && git pull && npm install && npx drizzle-kit push && npm run build && pm2 restart agent-core`
3. Dashboard at configured PORT (default 5001)

## Telegram Commands
- `/task <desc>` - Force-execute immediately (skip planning)
- `/status` - View running tasks
- `/cancel <id>` - Cancel a task
- `/list` - Recent tasks
- `/test` - Test AI connection
- `/reset` - Clear conversation history
- `/memory` - View stored memories
- `/forget` - Wipe all memory
- `/remember <text>` - Save a note to memory
- `/schedules` - View recurring tasks
- `/unschedule <id>` - Remove recurring task
