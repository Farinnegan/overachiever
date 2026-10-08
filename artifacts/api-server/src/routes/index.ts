import { Router, type IRouter } from "express";
import healthRouter from "./health";
import repTrainingRouter from "./rep-training";

const router: IRouter = Router();

router.use(healthRouter);
router.use(repTrainingRouter);

export default router;
