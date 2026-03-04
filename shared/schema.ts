import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const agentSettings = pgTable("agent_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(1),
  result: text("result"),
  error: text("error"),
  telegramChatId: text("telegram_chat_id"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(5),
  totalTokens: integer("total_tokens").notNull().default(0),
  totalCostUsd: text("total_cost_usd").notNull().default("0"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

export const taskLogs = pgTable("task_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  toolUsed: text("tool_used"),
  status: text("status").notNull(),
  tokenCount: integer("token_count").default(0),
  costUsd: text("cost_usd").default("0"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const credentials = pgTable("credentials", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  label: text("label").notNull(),
  username: text("username").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  metadata: text("metadata"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tasksRelations = relations(tasks, ({ many }) => ({
  logs: many(taskLogs),
}));

export const taskLogsRelations = relations(taskLogs, ({ one }) => ({
  task: one(tasks, { fields: [taskLogs.taskId], references: [tasks.id] }),
}));

export const agentMemories = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  source: text("source").notNull().default("task"),
  tags: text("tags"),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  intervalMinutes: integer("interval_minutes").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at").notNull(),
  lastResult: text("last_result"),
  isActive: boolean("is_active").notNull().default(true),
  activeStartHour: integer("active_start_hour"),
  activeEndHour: integer("active_end_hour"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertSettingSchema = createInsertSchema(agentSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  status: true,
  retryCount: true,
  totalTokens: true,
  totalCostUsd: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertTaskLogSchema = createInsertSchema(taskLogs).omit({
  id: true,
  createdAt: true,
});

export const insertCredentialSchema = createInsertSchema(credentials).omit({
  id: true,
  isActive: true,
  lastUsedAt: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type AgentSetting = typeof agentSettings.$inferSelect;
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type TaskLog = typeof taskLogs.$inferSelect;
export type InsertTaskLog = z.infer<typeof insertTaskLogSchema>;
export type Credential = typeof credentials.$inferSelect;
export type InsertCredential = z.infer<typeof insertCredentialSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export const insertMemorySchema = createInsertSchema(agentMemories).omit({
  id: true,
  createdAt: true,
});
export type AgentMemory = typeof agentMemories.$inferSelect;
export type InsertMemory = z.infer<typeof insertMemorySchema>;

export const insertScheduledTaskSchema = createInsertSchema(scheduledTasks).omit({
  id: true,
  lastRunAt: true,
  lastResult: true,
  isActive: true,
  createdAt: true,
});
export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = z.infer<typeof insertScheduledTaskSchema>;
