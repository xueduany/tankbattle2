import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../lib/logger";
import { deploy } from "../lib/deploy";

const router = Router();

function verifyAdminToken(provided: string | undefined): boolean {
  const token = process.env.DEPLOY_ADMIN_TOKEN;
  if (!token || !provided) return false;
  try {
    // timing-safe compare
    const a = Buffer.from(createHmac("sha256", "salt").update(token).digest("hex"));
    const b = Buffer.from(createHmac("sha256", "salt").update(provided).digest("hex"));
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// POST /api/deploy  -H "Authorization: Bearer <DEPLOY_ADMIN_TOKEN>"
// Body (optional): { "branch": "main" }
router.post("/deploy", async (req, res) => {
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!verifyAdminToken(token)) {
    req.log.warn("Unauthorized deploy attempt");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branch: string = (req.body as { branch?: string })?.branch ?? process.env.DEPLOY_BRANCH ?? "main";
  logger.info({ branch }, "[manual-deploy] Triggered");

  const result = await deploy(branch);

  if (result.ok) {
    logger.info({ deploymentId: result.deploymentId }, "[manual-deploy] Succeeded");
    res.json({ ok: true, branch, gitLog: result.gitLog, deploymentId: result.deploymentId });
  } else {
    logger.error({ step: result.step, error: result.error }, "[manual-deploy] Failed");
    res.status(500).json({ ok: false, step: result.step, error: result.error });
  }
});

export default router;
