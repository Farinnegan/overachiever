import { createHash } from "node:crypto";
import { Router } from "express";
import { count, desc, eq, sql } from "drizzle-orm";
import { BASELINE_RULES, BASELINE_VERSION, replay, type Exercise, type Rule, type Rules } from "@workspace/rep-tracker";
import { db, repTrainingExamplesTable as examples, repTrainingTrackersTable as trackers } from "@workspace/db";
import {
  CreateRepTrainingExampleBody,
  CreateRepTrainingExampleHeader,
  CreateRepTrainingExampleResponse,
  DeleteRepTrainingExamplesResponse,
  EvaluateRepTrainingTrackerResponse,
  GetRepTrainingTrackerResponse,
  ListRepTrainingExamplesResponse,
} from "@workspace/api-zod";

const router = Router();
const CONTRIBUTOR_LIMIT = 500;
const DATASET_LIMIT = 10000;

// The random browser key is a read/delete credential. Never store or log it.
router.use("/rep-training", (req, res, next) => {
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
      examples: rows.map(({ id, exercise, label, source, aspectRatio, frames, sessionId, expectedCount, trackerVersion, createdAt }) =>
        ({ id, exercise, label, source, aspectRatio, frames, sessionId, expectedCount, trackerVersion, createdAt })),
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
  const { exercise, label, source, aspectRatio, frames, sessionId, expectedCount, trackerVersion } = parsed.data;
  if (source === "missed" && label !== "incorrect") {
    res.status(400).json({ error: "A missed rep is an incorrect count, not a form assessment." });
    return;
  }
  if (sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    res.status(400).json({ error: "Session ID must be a random UUID." });
    return;
  }
  if ((sessionId || expectedCount !== undefined) && (!sessionId || expectedCount === undefined)) {
    res.status(400).json({ error: "New feedback must include both its session ID and the actual rep count." });
    return;
  }
  if (expectedCount !== undefined &&
    (source === "missed" ? expectedCount < 1 : label === "correct" ? expectedCount !== 1 : expectedCount === 1)) {
    res.status(400).json({ error: "The actual rep count must match the selected feedback label." });
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
        sessionId: sessionId ?? null, expectedCount: expectedCount ?? null,
        trackerVersion: trackerVersion ?? BASELINE_VERSION,
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

type LabeledExample = {
  exercise: Exercise;
  aspectRatio: number;
  frames: { offsetMs: number; landmarks: { index: number; x: number; y: number; visibility: number }[] }[];
  expectedCount: number;
  sessionId: string;
};
type Report = {
  status: "insufficient_data" | "no_improvement" | "activated";
  message: string;
  trainingSessions: number;
  heldOutSessions: number;
  trainingExamples: number;
  heldOutExamples: number;
  baselineAccuracy: number | null;
  tunedAccuracy: number | null;
};
const accuracy = (items: LabeledExample[], rules: Rules) =>
  items.length ? items.filter((item) => replay(item.frames, item.exercise, item.aspectRatio, rules[item.exercise]) === item.expectedCount).length / items.length : 0;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const responseRules = async (contributorHash: string) => {
  const [active] = await db.select().from(trackers).where(eq(trackers.contributorHash, contributorHash)).limit(1);
  return active ?? null;
};

router.get("/rep-training/tracker", async (_req, res) => {
  const active = await responseRules(res.locals.contributorHash);
  res.json(GetRepTrainingTrackerResponse.parse({
    version: active?.version ?? BASELINE_VERSION,
    rules: active?.rules ?? BASELINE_RULES,
    report: active?.report ?? null,
  }));
});

router.post("/rep-training/tracker", async (req, res) => {
  const contributorHash = res.locals.contributorHash as string;
  try {
    const eligible = await db.select().from(examples)
      .where(eq(examples.contributorHash, contributorHash));
    const labeled: LabeledExample[] = eligible.flatMap((row) =>
      row.exercise !== "push-up" && row.sessionId && Number.isInteger(row.expectedCount)
        ? [{ exercise: row.exercise, aspectRatio: row.aspectRatio, frames: row.frames, expectedCount: row.expectedCount!, sessionId: row.sessionId }]
        : []);
    const sessions = [...new Set(labeled.map((item) => item.sessionId))].sort((a, b) => sha(a).localeCompare(sha(b)));
    // A keyed, stable assignment prevents a previously held-out session from
    // moving into training when more sessions are added and the report reruns.
    const heldOutIds = new Set(sessions.filter((sessionId) =>
      Number.parseInt(sha(`${contributorHash}:${sessionId}`).slice(0, 8), 16) % 5 === 0));
    const training = labeled.filter((item) => !heldOutIds.has(item.sessionId));
    const heldOut = labeled.filter((item) => heldOutIds.has(item.sessionId));
    const trainingSessions = sessions.length - heldOutIds.size;
    const heldOutSessions = heldOutIds.size;
    const active = await responseRules(contributorHash);
    const incumbent = active?.rules ?? BASELINE_RULES;
    const insufficient: Report = {
      status: "insufficient_data",
      message: "Need at least two training sessions, two held-out sessions, four training examples and two held-out examples with actual rep counts. Session assignments stay fixed across evaluations.",
      trainingSessions, heldOutSessions,
      trainingExamples: training.length, heldOutExamples: heldOut.length,
      baselineAccuracy: null, tunedAccuracy: null,
    };
    let report: Report = insufficient;
    let nextRules: Rules = incumbent;
    let nextVersion = active?.version ?? BASELINE_VERSION;
    if (trainingSessions >= 2 && heldOutSessions >= 2 && training.length >= 4 && heldOut.length >= 2) {
      nextRules = structuredClone(incumbent);
      for (const exercise of ["squat", "bicep-curl"] as Exercise[]) {
        const trainExercise = training.filter((item) => item.exercise === exercise);
        const testExercise = heldOut.filter((item) => item.exercise === exercise);
        if (trainExercise.length < 4 || testExercise.length < 2) continue;
        const base = incumbent[exercise];
        let best = base;
        let bestAccuracy = accuracy(trainExercise, { ...incumbent, [exercise]: base });
        for (const extendedDelta of [-15, -10, -5, 0, 5, 10, 15]) {
          for (const bentDelta of [-15, -10, -5, 0, 5, 10, 15]) {
            const candidate: Rule = {
              ...base,
              extended: Math.max(120, Math.min(175, base.extended + extendedDelta)),
              bent: Math.max(45, Math.min(130, base.bent + bentDelta)),
            };
            if (candidate.bent >= candidate.extended - 10) continue;
            const candidateRules = { ...incumbent, [exercise]: candidate };
            const score = accuracy(trainExercise, candidateRules);
            const distance = Math.abs(candidate.extended - base.extended) + Math.abs(candidate.bent - base.bent);
            const bestDistance = Math.abs(best.extended - base.extended) + Math.abs(best.bent - base.bent);
            if (score > bestAccuracy || (score === bestAccuracy && distance < bestDistance)) {
              best = candidate;
              bestAccuracy = score;
            }
          }
        }
        nextRules[exercise] = best;
      }
      const baselineAccuracy = accuracy(heldOut, incumbent);
      const tunedAccuracy = accuracy(heldOut, nextRules);
      const materiallyTuned = JSON.stringify(nextRules) !== JSON.stringify(incumbent);
      const exerciseSafe = (["squat", "bicep-curl"] as Exercise[]).every((exercise) => {
        const samples = heldOut.filter((item) => item.exercise === exercise);
        return !samples.length || accuracy(samples, nextRules) >= accuracy(samples, incumbent);
      });
      const activated = materiallyTuned && exerciseSafe && tunedAccuracy > baselineAccuracy && tunedAccuracy >= .8;
      report = {
        status: activated ? "activated" : "no_improvement",
        message: activated
        ? "Tuned local counting thresholds passed the held-out session check and are now active on this device."
          : "Tuned thresholds did not beat the current rules without an exercise-level regression on held-out sessions, so the active rules were kept.",
        trainingSessions, heldOutSessions,
        trainingExamples: training.length, heldOutExamples: heldOut.length,
        baselineAccuracy, tunedAccuracy,
      };
      if (!activated) nextRules = incumbent;
      else {
        const fingerprint = sha(JSON.stringify(nextRules)).slice(0, 10);
        nextVersion = `mediapipe-lite-0.10.35/rules-v2-${fingerprint}`;
      }
    }
    const [saved] = await db.insert(trackers).values({
      contributorHash, version: nextVersion, rules: nextRules, report,
    }).onConflictDoUpdate({
      target: trackers.contributorHash,
      set: { version: nextVersion, rules: nextRules, report, updatedAt: new Date() },
    }).returning();
    res.json(EvaluateRepTrainingTrackerResponse.parse({
      version: saved!.version, rules: saved!.rules, report: saved!.report,
    }));
  } catch {
    req.log.error("Failed to evaluate contributed rep examples");
    res.status(500).json({ error: "Could not evaluate your examples. Please try again." });
  }
});

router.delete("/rep-training/examples", async (req, res) => {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(8273101)`);
      const deleted = await tx.delete(examples).where(eq(examples.contributorHash, res.locals.contributorHash))
        .returning({ id: examples.id });
      await tx.delete(trackers).where(eq(trackers.contributorHash, res.locals.contributorHash));
      return deleted;
    });
    res.json(DeleteRepTrainingExamplesResponse.parse({ deletedCount: rows.length }));
  } catch {
    req.log.error("Failed to delete contributed examples");
    res.status(500).json({ error: "Could not delete your examples. Please try again." });
  }
});

export default router;
