import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../lib/logger";

const router = Router();

function verifySignature(secret: string, payload: Buffer, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

router.post(
  "/github/webhook",
  (req, res) => {
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
      req.log.error("Raw body not available — ensure rawBody middleware is enabled");
      res.status(500).json({ error: "Internal error" });
      return;
    }

    if (!verifySignature(secret, rawBody, signature)) {
      req.log.warn({ signature }, "Invalid webhook signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const event = req.headers["x-github-event"] as string;
    const delivery = req.headers["x-github-delivery"] as string;
    const payload = req.body;

    req.log.info({ event, delivery }, "GitHub webhook received");

    switch (event) {
      case "push": {
        const branch = (payload.ref as string)?.replace("refs/heads/", "");
        const commits: number = payload.commits?.length ?? 0;
        const pusher: string = payload.pusher?.name ?? "unknown";
        req.log.info({ branch, commits, pusher }, "Push event");
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
        req.log.info({ hook_id: payload.hook_id }, "Ping — webhook connected successfully");
        break;
      }
      default:
        req.log.info({ event }, "Unhandled GitHub event");
    }

    res.status(200).json({ ok: true });
  },
);

export default router;
