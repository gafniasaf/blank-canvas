/**
 * BookGen MCP Server
 *
 * HTTP JSON-RPC server for AI agent control.
 * Port 4100, Bearer token auth.
 *
 * Methods:
 *   bookgen.health, bookgen.enqueueJob, bookgen.listJobs, bookgen.getJob,
 *   bookgen.cancelJob, bookgen.bookList, bookgen.bookRegister,
 *   bookgen.bookStatus, bookgen.monitor, bookgen.contractsSnapshot, bookgen.verify
 */

import http from "node:http";
import { config } from "./config.js";
import { supabaseRest, supabaseRpc } from "./http.js";
import { healthHandler } from "./handlers/health.js";
import { enqueueJobHandler } from "./handlers/enqueueJob.js";
import { listJobsHandler } from "./handlers/listJobs.js";
import { getJobHandler } from "./handlers/getJob.js";
import { cancelJobHandler } from "./handlers/cancelJob.js";
import { bookListHandler } from "./handlers/bookList.js";
import { bookRegisterHandler } from "./handlers/bookRegister.js";
import { bookStatusHandler } from "./handlers/bookStatus.js";
import { monitorHandler } from "./handlers/monitor.js";
import { contractsSnapshotHandler } from "./handlers/contractsSnapshot.js";
import { verifyHandler } from "./handlers/verify.js";

const METHODS = [
  "bookgen.health",
  "bookgen.enqueueJob",
  "bookgen.listJobs",
  "bookgen.getJob",
  "bookgen.cancelJob",
  "bookgen.bookList",
  "bookgen.bookRegister",
  "bookgen.bookStatus",
  "bookgen.monitor",
  "bookgen.contractsSnapshot",
  "bookgen.verify",
] as const;

type HandlerFn = (params: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, HandlerFn> = {
  "bookgen.health": healthHandler,
  "bookgen.enqueueJob": enqueueJobHandler,
  "bookgen.listJobs": listJobsHandler,
  "bookgen.getJob": getJobHandler,
  "bookgen.cancelJob": cancelJobHandler,
  "bookgen.bookList": bookListHandler,
  "bookgen.bookRegister": bookRegisterHandler,
  "bookgen.bookStatus": bookStatusHandler,
  "bookgen.monitor": monitorHandler,
  "bookgen.contractsSnapshot": contractsSnapshotHandler,
  "bookgen.verify": verifyHandler,
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, methods: METHODS });
  }

  if (req.method !== "POST") {
    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== config.mcpAuthToken) {
    return send(res, 401, { ok: false, error: "Unauthorized" });
  }

  try {
    const body = await readBody(req);
    const { method, params = {} } = body ?? {};
    if (!method || typeof method !== "string") {
      return send(res, 400, { ok: false, error: "method is required" });
    }

    const handler = handlers[method];
    if (!handler) {
      return send(res, 404, { ok: false, error: `Unknown method: ${method}` });
    }

    const result = await handler(params as Record<string, unknown>);
    return send(res, 200, { ok: true, result });
  } catch (error) {
    console.error("[MCP Error]", error);
    const message = error instanceof Error ? error.message : String(error);
    return send(res, 500, { ok: false, error: message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`🔌 BookGen MCP server running at http://${config.host}:${config.port}`);
  console.log(`   Methods: ${METHODS.length}`);
  console.log(`   Auth: Bearer token`);
});

export { supabaseRest, supabaseRpc };

