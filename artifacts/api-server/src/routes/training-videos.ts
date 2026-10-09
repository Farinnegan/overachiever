import { Router } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, trainingVideosTable as videos } from "@workspace/db";
import {
  CompleteTrainingVideoUploadParams, CompleteTrainingVideoUploadResponse,
  DeleteTrainingVideoResponse, ListTrainingVideosResponse, RequestTrainingVideoUploadBody,
  RequestTrainingVideoUploadResponse,
} from "@workspace/api-zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";

const router = Router();
const storage = new ObjectStorageService();
const limit = 50;
const datasetLimit = 500;
const MAX_BYTES = 20 * 1024 * 1024;

router.use("/rep-training/videos", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in to upload or access training clips." }); return; }
  res.locals.videoOwner = req.user.id;
  next();
});
router.param("id", (_req, res, next, id) => {
  const parsed = CompleteTrainingVideoUploadParams.safeParse({ id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid clip ID." }); return; }
  res.locals.videoId = parsed.data.id; next();
});

const own = (res: { locals: Record<string, any> }) =>
  and(eq(videos.ownerId, res.locals.videoOwner), eq(videos.id, res.locals.videoId));
const publicMetadata = ({ ownerId: _owner, objectPath: _path, consentVersion: _consent, ...row }: typeof videos.$inferSelect) => row;

router.get("/rep-training/videos", async (req, res) => {
  try {
    const rows = await db.select().from(videos).where(eq(videos.ownerId, res.locals.videoOwner))
      .orderBy(desc(videos.createdAt)).limit(limit);
    res.json(ListTrainingVideosResponse.parse({ videos: rows.map(publicMetadata) }));
  } catch { req.log.error("Training clip listing failed"); res.status(500).json({ error: "Could not load clips." }); }
});

router.post("/rep-training/videos/uploads", async (req, res) => {
  const parsed = RequestTrainingVideoUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Explicit video consent and a valid clip of 1–15 seconds, up to 20MB, are required." }); return; }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    const { consent: _consent, ...metadata } = parsed.data;
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(8273102)`);
      const [mine] = await tx.select({ value: count() }).from(videos).where(eq(videos.ownerId, res.locals.videoOwner));
      const [total] = await tx.select({ value: count() }).from(videos);
      if (mine!.value >= limit || total!.value >= datasetLimit) return null;
      const [inserted] = await tx.insert(videos).values({ ...metadata, ownerId: res.locals.videoOwner, objectPath }).returning();
      return inserted!;
    });
    if (!row) { res.status(429).json({ error: "Clip storage is full. Delete existing or incomplete clips before uploading more." }); return; }
    res.status(201).json(RequestTrainingVideoUploadResponse.parse({ id: row.id, uploadURL }));
  } catch { req.log.error("Training clip reservation failed"); res.status(500).json({ error: "Could not prepare the clip upload." }); }
});

router.post("/rep-training/videos/:id/complete", async (req, res) => {
  try {
    const [row] = await db.select().from(videos).where(own(res));
    if (!row) { res.status(404).json({ error: "Clip not found." }); return; }
    if (row.ready) { res.json(CompleteTrainingVideoUploadResponse.parse(publicMetadata(row))); return; }
    const file = await storage.getObjectEntityFile(row.objectPath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (size !== row.size || size > MAX_BYTES || String(metadata.contentType).split(";")[0] !== row.contentType) {
      await file.delete({ ignoreNotFound: true });
      res.status(400).json({ error: "Uploaded file did not match the reserved clip. Discard it and record again." }); return;
    }
    await setObjectAclPolicy(file, { owner: row.ownerId, visibility: "private" });
    const [saved] = await db.update(videos).set({ ready: true }).where(own(res)).returning();
    res.json(CompleteTrainingVideoUploadResponse.parse(publicMetadata(saved!)));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(409).json({ error: "The clip upload has not finished. Retry uploading it." }); return; }
    req.log.error("Training clip finalization failed"); res.status(500).json({ error: "Clip was not confirmed saved. Retry to finish it." });
  }
});

router.get("/rep-training/videos/:id/content", async (req, res) => {
  try {
    const [row] = await db.select().from(videos).where(own(res));
    if (!row?.ready) { res.status(404).json({ error: "Saved clip not found." }); return; }
    const file = await storage.getObjectEntityFile(row.objectPath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    res.set({ "Content-Type": row.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
    let start = 0; let end = size - 1;
    const range = req.get("Range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.status(416).set("Content-Range", `bytes */${size}`).end(); return; }
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= size) { res.status(416).set("Content-Range", `bytes */${size}`).end(); return; }
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    res.set("Content-Length", String(end - start + 1));
    const stream = file.createReadStream({ start, end });
    stream.on("error", () => { req.log.error("Training clip stream failed"); res.destroy(); });
    stream.pipe(res);
  } catch { req.log.error("Training clip read failed"); if (!res.headersSent) res.status(404).json({ error: "Clip file unavailable." }); }
});

router.delete("/rep-training/videos/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(videos).where(own(res));
    if (!row) { res.status(404).json({ error: "Clip not found." }); return; }
    try {
      const file = await storage.getObjectEntityFile(row.objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) { if (!(error instanceof ObjectNotFoundError)) throw error; }
    await db.delete(videos).where(own(res));
    res.json(DeleteTrainingVideoResponse.parse({ deleted: true }));
  } catch { req.log.error("Training clip deletion failed"); res.status(500).json({ error: "Could not delete the clip. Retry." }); }
});
export default router;
