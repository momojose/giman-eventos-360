import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const venues = sqliteTable("venues", { id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true), googleCalendarId: text("google_calendar_id") });
export const clients = sqliteTable("clients", { id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), email: text("email"), phone: text("phone"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`) });
export const events = sqliteTable("events", { id: integer("id").primaryKey({ autoIncrement: true }), clientId: integer("client_id").notNull(), venueId: integer("venue_id").notNull(), name: text("name").notNull(), eventDate: text("event_date").notNull(), startTime: text("start_time"), endTime: text("end_time"), endDate: text("end_date"), timezone: text("timezone").notNull().default("Europe/Madrid"), calendarDirty: integer("calendar_dirty", { mode: "boolean" }).notNull().default(true), calendarRevision: integer("calendar_revision").notNull().default(1), guests: integer("guests").notNull().default(0), status: text("status").notNull().default("lead"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`) });
export const budgets = sqliteTable("budgets", { id: integer("id").primaryKey({ autoIncrement: true }), eventId: integer("event_id").notNull(), version: integer("version").notNull().default(1), revenue: real("revenue").notNull().default(0), estimatedCost: real("estimated_cost").notNull().default(0), status: text("status").notNull().default("draft"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`) });
export const payments = sqliteTable("payments", { id: integer("id").primaryKey({ autoIncrement: true }), eventId: integer("event_id").notNull(), amount: real("amount").notNull(), dueDate: text("due_date").notNull(), paidAt: text("paid_at"), status: text("status").notNull().default("pending") });
export const tasks = sqliteTable("tasks", { id: integer("id").primaryKey({ autoIncrement: true }), eventId: integer("event_id").notNull(), title: text("title").notNull(), owner: text("owner").notNull(), dueDate: text("due_date"), priority: text("priority").notNull().default("medium"), completed: integer("completed", { mode: "boolean" }).notNull().default(false) });
export const serviceOrders = sqliteTable("service_orders", { id: integer("id").primaryKey({ autoIncrement: true }), eventId: integer("event_id").notNull(), department: text("department").notNull(), instructions: text("instructions").notNull().default(""), status: text("status").notNull().default("draft"), approvedAt: text("approved_at") });
export const closures = sqliteTable("closures", { id: integer("id").primaryKey({ autoIncrement: true }), eventId: integer("event_id").notNull(), actualRevenue: real("actual_revenue").notNull().default(0), actualCost: real("actual_cost").notNull().default(0), notes: text("notes").notNull().default(""), closedAt: text("closed_at") });
export const eventInterviews = sqliteTable("event_interviews", { id: integer("id").primaryKey({ autoIncrement: true }), eventId: integer("event_id").notNull().unique(), payload: text("payload").notNull().default("{}"), completion: integer("completion").notNull().default(0), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`) });

export const eventCalendarSyncs = sqliteTable("event_calendar_syncs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().references(() => events.id, { onUpdate: "no action", onDelete: "restrict" }),
  targetKind: text("target_kind").notNull(),
  targetCalendarId: text("target_calendar_id").notNull(),
  googleEventId: text("google_event_id"),
  googleEtag: text("google_etag"),
  lastPayloadHash: text("last_payload_hash"),
  syncState: text("sync_state").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  lastAttemptAt: text("last_attempt_at"),
  syncedAt: text("synced_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("event_calendar_syncs_event_target_unique").on(table.eventId, table.targetKind),
  index("event_calendar_syncs_state_updated_idx").on(table.syncState, table.updatedAt),
  check("event_calendar_syncs_target_kind_check", sql`${table.targetKind} in ('master', 'venue')`),
  check("event_calendar_syncs_sync_state_check", sql`${table.syncState} in ('pending', 'syncing', 'synced', 'delete_pending', 'deleted', 'error')`),
]);
