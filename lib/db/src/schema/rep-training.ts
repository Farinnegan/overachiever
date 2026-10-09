import { index, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("rep_training_contributor_idx").on(table.contributorHash)]);

export const insertRepTrainingExampleSchema = createInsertSchema(repTrainingExamplesTable).omit({
  id: true, createdAt: true,
});
export type RepTrainingExample = typeof repTrainingExamplesTable.$inferSelect;
