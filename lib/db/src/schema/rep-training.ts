import { index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { Rules } from "@workspace/rep-tracker";

export type TrainingPoseFrame = {
  offsetMs: number;
  phase: "stand" | "lower" | "bottom" | "return" | "unknown";
  landmarks: { index: number; x: number; y: number; visibility: number }[];
};

export const repTrainingExamplesTable = pgTable("rep_training_examples", {
  id: uuid("id").defaultRandom().primaryKey(),
  contributorHash: text("contributor_hash").notNull(),
  exercise: text("exercise").$type<"squat" | "push-up" | "bicep-curl">().notNull(),
  label: text("label").$type<"correct" | "incorrect">().notNull(),
  source: text("source").$type<"counted" | "missed">().notNull().default("counted"),
  aspectRatio: real("aspect_ratio").notNull(),
  frames: jsonb("frames").$type<TrainingPoseFrame[]>().notNull(),
  consentVersion: text("consent_version").notNull().default("pose-only-v1"),
  trackerVersion: text("tracker_version").notNull().default("mediapipe-lite-0.10.35/rules-v1"),
  sessionId: text("session_id"),
  expectedCount: integer("expected_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("rep_training_contributor_idx").on(table.contributorHash),
  index("rep_training_session_idx").on(table.contributorHash, table.sessionId),
]);

export const repTrainingTrackersTable = pgTable("rep_training_trackers", {
  contributorHash: text("contributor_hash").primaryKey(),
  version: text("version").notNull(),
  rules: jsonb("rules").$type<Rules>().notNull(),
  report: jsonb("report").$type<{
    status: "insufficient_data" | "no_improvement" | "activated";
    message: string;
    trainingSessions: number;
    heldOutSessions: number;
    trainingExamples: number;
    heldOutExamples: number;
    baselineAccuracy: number | null;
    tunedAccuracy: number | null;
  }>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertRepTrainingExampleSchema = createInsertSchema(repTrainingExamplesTable).omit({
  id: true, createdAt: true,
});
export type RepTrainingExample = typeof repTrainingExamplesTable.$inferSelect;
