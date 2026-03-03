import {
  users, agentSettings, tasks, taskLogs, credentials, conversations, messages,
  type User, type InsertUser, type AgentSetting, type InsertSetting,
  type Task, type InsertTask, type TaskLog, type InsertTaskLog,
  type Credential, type InsertCredential, type Conversation, type Message
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getSetting(key: string): Promise<AgentSetting | undefined>;
  getAllSettings(): Promise<AgentSetting[]>;
  upsertSetting(key: string, value: string): Promise<AgentSetting>;
  deleteSetting(key: string): Promise<void>;

  getTask(id: number): Promise<Task | undefined>;
  getAllTasks(): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, data: Partial<Task>): Promise<Task | undefined>;
  deleteTask(id: number): Promise<void>;

  getTaskLogs(taskId: number): Promise<TaskLog[]>;
  createTaskLog(log: InsertTaskLog): Promise<TaskLog>;
  getAllLogs(): Promise<TaskLog[]>;

  getCredential(id: number): Promise<Credential | undefined>;
  getAllCredentials(): Promise<Credential[]>;
  createCredential(cred: InsertCredential): Promise<Credential>;
  updateCredential(id: number, data: Partial<Credential>): Promise<Credential | undefined>;
  deleteCredential(id: number): Promise<void>;

  getStats(): Promise<{ totalTasks: number; completedTasks: number; failedTasks: number; runningTasks: number; totalTokens: number; totalCost: string }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getSetting(key: string): Promise<AgentSetting | undefined> {
    const [setting] = await db.select().from(agentSettings).where(eq(agentSettings.key, key));
    return setting || undefined;
  }

  async getAllSettings(): Promise<AgentSetting[]> {
    return db.select().from(agentSettings).orderBy(asc(agentSettings.key));
  }

  async upsertSetting(key: string, value: string): Promise<AgentSetting> {
    const [setting] = await db
      .insert(agentSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: agentSettings.key, set: { value, updatedAt: sql`CURRENT_TIMESTAMP` } })
      .returning();
    return setting;
  }

  async deleteSetting(key: string): Promise<void> {
    await db.delete(agentSettings).where(eq(agentSettings.key, key));
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task || undefined;
  }

  async getAllTasks(): Promise<Task[]> {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [created] = await db.insert(tasks).values(task).returning();
    return created;
  }

  async updateTask(id: number, data: Partial<Task>): Promise<Task | undefined> {
    const [updated] = await db
      .update(tasks)
      .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async getTaskLogs(taskId: number): Promise<TaskLog[]> {
    return db.select().from(taskLogs).where(eq(taskLogs.taskId, taskId)).orderBy(asc(taskLogs.step));
  }

  async createTaskLog(log: InsertTaskLog): Promise<TaskLog> {
    const [created] = await db.insert(taskLogs).values(log).returning();
    return created;
  }

  async getAllLogs(): Promise<TaskLog[]> {
    return db.select().from(taskLogs).orderBy(desc(taskLogs.createdAt)).limit(200);
  }

  async getCredential(id: number): Promise<Credential | undefined> {
    const [cred] = await db.select().from(credentials).where(eq(credentials.id, id));
    return cred || undefined;
  }

  async getAllCredentials(): Promise<Credential[]> {
    return db.select().from(credentials).orderBy(desc(credentials.createdAt));
  }

  async createCredential(cred: InsertCredential): Promise<Credential> {
    const [created] = await db.insert(credentials).values(cred).returning();
    return created;
  }

  async updateCredential(id: number, data: Partial<Credential>): Promise<Credential | undefined> {
    const [updated] = await db
      .update(credentials)
      .set(data)
      .where(eq(credentials.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteCredential(id: number): Promise<void> {
    await db.delete(credentials).where(eq(credentials.id, id));
  }

  async getStats() {
    const allTasks = await db.select().from(tasks);
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === "completed").length;
    const failedTasks = allTasks.filter(t => t.status === "failed").length;
    const runningTasks = allTasks.filter(t => t.status === "running").length;
    const totalTokens = allTasks.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
    const totalCost = allTasks.reduce((sum, t) => sum + parseFloat(t.totalCostUsd || "0"), 0).toFixed(4);
    return { totalTasks, completedTasks, failedTasks, runningTasks, totalTokens, totalCost };
  }
}

export const storage = new DatabaseStorage();
