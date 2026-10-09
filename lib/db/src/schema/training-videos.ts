import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const trainingVideosTable = pgTable("training_videos", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectPath: text("object_path").notNull().unique(),
  exercise: text("exercise").$type<"squat" | "push-up" | "bicep-curl">().notNull(),
  expectedReps: integer("expected_reps").notNull(),
  countedReps: integer("counted_reps").notNull(),
  placement: text("placement").$type<"floor" | "body-level" | "other">().notNull(),
  durationMs: integer("duration_ms").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  ready: boolean("ready").default(false).notNull(),
  consentVersion: text("consent_version").default("video-training-v1").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("training_video_owner_idx").on(table.ownerId)]);
