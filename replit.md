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
- **Tools**: run_command (shell), web scrape, code exec, HTTP requests, file ops, search_web, save_memory

## Key Design Decisions (OpenClaw-aligned)
- **Unified session**: No separate "chat mode" vs "task mode" — one continuous conversation per chat. Conversation context flows into task execution
- **Memory with search**: BM25-style keyword search over structured memory entries (not a flat string). Relevant memories injected per-task
- **Context compaction**: When conversation exceeds 30 messages, old messages are AI-summarized into a compact summary (OpenClaw-style pruning)
- **Heartbeat scheduling**: Recurring tasks via `scheduled_tasks` table, checked every 60s. "Every 15 minutes" actually works
- **Autonomous prompt**: Agent thinks independently, never asks for clarification, uses get_credentials before complaining, searches the web for factual questions
- **No fake tools**: Puppeteer stubs removed (they returned fake success). Agent uses run_command for real power

## Key Files

### Backend
- `server/agent/core.ts` - Agent execution loop with context compaction and memory search
- `server/agent/prompt.ts` - Autonomous system prompt (never ask, always act)
- `server/agent/openrouter.ts` - OpenRouter API client with cost tracking
- `server/agent/tools.ts` - Tool registry (11 real tools, no stubs)
- `server/agent/memory.ts` - Long-term memory with BM25 keyword search
- `server/agent/heartbeat.ts` - Scheduled task runner (60s check loop, active hours, duplicate suppression, overlap protection)
- `server/agent/session.ts` - JSONL-based session persistence (survives restarts, auto-archive on /reset)
- `server/telegram.ts` - Telegram bot: unified session, plan→confirm→execute, scheduling, memory commands
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
