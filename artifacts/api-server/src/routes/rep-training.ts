import { createHash } from "node:crypto";
import { Router } from "express";
import { count, desc, eq, sql } from "drizzle-orm";
import { db, repTrainingExamplesTable as examples } from "@workspace/db";
import {
  CreateRepTrainingExampleBody,
  CreateRepTrainingExampleHeader,
  CreateRepTrainingExampleResponse,
  DeleteRepTrainingExamplesResponse,
  ListRepTrainingExamplesResponse,
} from "@workspace/api-zod";

const router = Router();
const CONTRIBUTOR_LIMIT = 500;
const DATASET_LIMIT = 10000;

// The random browser key is a read/delete credential. Never store or log it.
router.use("/rep-training/examples", (req, res, next) => {
  const parsed = CreateRepTrainingExampleHeader.safeParse({
    "X-Contributor-Token": req.get("X-Contributor-Token"),
  });
  if (!parsed.success) {
    res.status(401).json({ error: "A valid contributor key is required." });
    return;
  }
  res.locals.contributorHash = createHash("sha256")
    .update(parsed.data["X-Contributor-Token"].toLowerCase()).digest("hex");
  next();
});

router.get("/rep-training/examples", async (req, res) => {
  try {
    const rows = await db.select().from(examples)
      .where(eq(examples.contributorHash, res.locals.contributorHash))
      .orderBy(desc(examples.createdAt)).limit(CONTRIBUTOR_LIMIT);
    const payload = {
      examples: rows.map(({ id, exercise, label, source, aspectRatio, frames, createdAt }) =>
        ({ id, exercise, label, source, aspectRatio, frames, createdAt })),
      limit: CONTRIBUTOR_LIMIT,
      remaining: Math.max(0, CONTRIBUTOR_LIMIT - rows.length),
    };
    res.json(ListRepTrainingExamplesResponse.parse(payload));
  } catch {
    req.log.error("Failed to list contributed examples");
    res.status(500).json({ error: "Could not load your examples. Please try again." });
  }
});

router.post("/rep-training/examples", async (req, res) => {
  const parsed = CreateRepTrainingExampleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Expected consent and a bounded, labeled pose sequence." });
    return;
  }
  const { exercise, label, source, aspectRatio, frames } = parsed.data;
  if (source === "missed" && label !== "incorrect") {
    res.status(400).json({ error: "A missed rep is an incorrect count, not a form assessment." });
    return;
  }
  const expected = exercise === "squat" ? [23, 24, 25, 26, 27, 28] : [11, 12, 13, 14, 15, 16];
  if (frames.some((frame, i) =>
    (i > 0 && frame.offsetMs <= frames[i - 1]!.offsetMs) ||
    new Set(frame.landmarks.map((p) => p.index)).size !== 6 ||
    frame.landmarks.some((p) => !expected.includes(p.index)))) {
    res.status(400).json({ error: "Frames must be chronological and contain only the six exercise joints." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      // Serializes count+insert/delete so concurrent uploads cannot exceed quotas.
      await tx.execute(sql`select pg_advisory_xact_lock(8273101)`);
      const [total] = await tx.select({ value: count() }).from(examples);
      const [own] = await tx.select({ value: count() }).from(examples)
        .where(eq(examples.contributorHash, res.locals.contributorHash));
      if (own!.value >= CONTRIBUTOR_LIMIT || total!.value >= DATASET_LIMIT) return null;
      const [row] = await tx.insert(examples).values({
        contributorHash: res.locals.contributorHash, exercise, label, source, aspectRatio, frames,
      }).returning({ id: examples.id });
      return row!;
    });
    if (!result) {
      res.status(429).json({ error: "Contribution storage is full. Export or delete existing examples before uploading more." });
      return;
    }
    res.status(201).json(CreateRepTrainingExampleResponse.parse({ id: result.id, accepted: true }));
  } catch {
    req.log.error("Failed to save contributed example");
    res.status(500).json({ error: "Your example was not confirmed saved. Please try again." });
  }
});

router.delete("/rep-training/examples", async (req, res) => {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(8273101)`);
      return tx.delete(examples).where(eq(examples.contributorHash, res.locals.contributorHash))
        .returning({ id: examples.id });
    });
    res.json(DeleteRepTrainingExamplesResponse.parse({ deletedCount: rows.length }));
  } catch {
    req.log.error("Failed to delete contributed examples");
    res.status(500).json({ error: "Could not delete your examples. Please try again." });
  }
});

export default router;
