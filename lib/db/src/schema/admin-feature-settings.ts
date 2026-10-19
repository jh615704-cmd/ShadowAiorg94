import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const adminFeatureSettingsTable = pgTable("admin_feature_settings", {
  id: integer("id").primaryKey().default(1),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminFeatureSettingsRow = typeof adminFeatureSettingsTable.$inferSelect;
