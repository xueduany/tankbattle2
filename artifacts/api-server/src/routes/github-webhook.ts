import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../lib/logger";
import { deploy } from "../lib/deploy";

const router = Router();

const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH ?? "main";

function verifySignature(secret: string, payload: Buffer, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

router.post("/github/webhook", (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    req.log.error("GITHUB_WEBHOOK_SECRET is not set");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") {
    req.log.warn("Missing X-Hub-Signature-256 header");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody: Buffer = (req as unknown as { rawBody: Buffer }).rawBody;
  if (!rawBody) {
    req.log.error("Raw body not available");
    res.status(500).json({ error: "Internal error" });
    return;
  }

  if (!verifySignature(secret, rawBody, signature)) {
    req.log.warn("Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.headers["x-github-event"] as string;
  const delivery = req.headers["x-github-delivery"] as string;
  const payload = req.body;

  req.log.info({ event, delivery }, "GitHub webhook received");

  // 立即返回 200，异步处理部署（GitHub 要求 10s 内响应）
  res.status(200).json({ ok: true });

  switch (event) {
    case "push": {
      const branch = (payload.ref as string)?.replace("refs/heads/", "");
      const commits: number = payload.commits?.length ?? 0;
      const pusher: string = payload.pusher?.name ?? "unknown";
      req.log.info({ branch, commits, pusher }, "Push event");

      if (branch !== DEPLOY_BRANCH) {
        logger.info({ branch, DEPLOY_BRANCH }, "[webhook] Skipping deploy — not target branch");
        break;
      }

      logger.info({ branch }, "[webhook] Starting auto-deploy");
      deploy(branch).then((result) => {
        if (result.ok) {
          logger.info(
            { deploymentId: result.deploymentId, gitLog: result.gitLog },
            "[webhook] Auto-deploy succeeded",
          );
        } else {
          logger.error(
            { step: result.step, error: result.error },
            "[webhook] Auto-deploy failed",
          );
        }
      });
      break;
    }

    case "pull_request": {
      const action: string = payload.action;
      const number: number = payload.number;
      const title: string = payload.pull_request?.title;
      req.log.info({ action, number, title }, "Pull request event");
      break;
    }

    case "ping": {
      logger.info({ hook_id: payload.hook_id }, "Ping — webhook connected successfully");
      break;
    }

    default:
      logger.info({ event }, "Unhandled GitHub event");
  }
});

export default router;
