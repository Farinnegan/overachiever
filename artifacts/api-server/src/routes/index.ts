import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import trainingVideosRouter from "./training-videos";
import repTrainingRouter from "./rep-training";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(trainingVideosRouter);
router.use(repTrainingRouter);

export default router;
