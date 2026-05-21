import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const WORKSPACE = "/home/runner/workspace";

export type DeployResult =
  | { ok: true; gitLog: string; deploymentId: string }
  | { ok: false; step: "git" | "install" | "publish"; error: string };

/**
 * 1. git pull
 * 2. pnpm install
 * 3. 调用 Replit Deployments API 触发重新发布
 */
export async function deploy(branch: string): Promise<DeployResult> {
  const apiToken = process.env.REPLIT_API_TOKEN;
  const replId = process.env.REPL_ID;

  if (!apiToken || !replId) {
    return {
      ok: false,
      step: "publish",
      error: "REPLIT_API_TOKEN or REPL_ID not set",
    };
  }

  // ── Step 1: git pull ──────────────────────────────────────────────
  logger.info({ branch }, "[deploy] Running git pull");
  let gitLog = "";
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["pull", "origin", branch, "--ff-only"],
      { cwd: WORKSPACE, timeout: 60_000 },
    );
    gitLog = stdout.trim() || stderr.trim();
    logger.info({ gitLog }, "[deploy] git pull done");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "[deploy] git pull failed");
    return { ok: false, step: "git", error: msg };
  }

  // ── Step 2: pnpm install ──────────────────────────────────────────
  logger.info("[deploy] Running pnpm install");
  try {
    await execFileAsync("pnpm", ["install", "--frozen-lockfile"], {
      cwd: WORKSPACE,
      timeout: 120_000,
    });
    logger.info("[deploy] pnpm install done");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "[deploy] pnpm install failed");
    return { ok: false, step: "install", error: msg };
  }

  // ── Step 3: Trigger Replit deployment ────────────────────────────
  logger.info({ replId }, "[deploy] Triggering Replit deployment");
  try {
    const resp = await fetch(
      `https://replit.com/api/v1/repls/${replId}/deployments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    const body = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const msg = `HTTP ${resp.status}: ${JSON.stringify(body)}`;
      logger.error({ status: resp.status, body }, "[deploy] Replit API error");
      return { ok: false, step: "publish", error: msg };
    }

    const deploymentId = (body as { id?: string }).id ?? "unknown";
    logger.info({ deploymentId }, "[deploy] Deployment triggered");
    return { ok: true, gitLog, deploymentId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "[deploy] Replit API request failed");
    return { ok: false, step: "publish", error: msg };
  }
}
