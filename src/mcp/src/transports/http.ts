import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@microsoft/microsoft-graph-client";
import { config } from "../config/env.js";
import { logger } from "../logger.js";
import { evaluate as evaluateGuardrails } from "../guardrails/engine.js";
import type { AuthCtx, ServerFactory } from "../types.js";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const DEFAULT_CORS_ORIGINS = [
  "https://copilotstudio.microsoft.com",
  "https://make.powerapps.com",
  "https://make.powerautomate.com",
];

function buildAllowedOrigins(): string[] {
  if (!config.ELIGRAPH_CORS_ORIGINS) return DEFAULT_CORS_ORIGINS;
  return config.ELIGRAPH_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
}

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers["origin"];
  const allowedOrigins = buildAllowedOrigins();

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// REST /api/graph — thin Graph API proxy for Power Platform custom connector
// ---------------------------------------------------------------------------
async function handleGraphRest(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  if (!token) {
    res.status(401).json({ success: false, error: "Bearer token required in Authorization header" });
    return;
  }

  const {
    apiType = "graph",
    method,
    path: apiPath,
    queryParams,
    body,
    graphApiVersion = "v1.0",
    confirm: bypassGuardrail = false,
  } = req.body ?? {};

  if (!method || !apiPath) {
    res.status(400).json({ success: false, error: "method and path are required" });
    return;
  }

  if (apiType !== "graph") {
    res.status(400).json({ success: false, error: "Only apiType='graph' is supported on this endpoint" });
    return;
  }

  // Guardrail check
  const guardrail = evaluateGuardrails({ apiType, method, path: apiPath, body }, bypassGuardrail === true);
  if (!guardrail.allowed) {
    const httpStatus = guardrail.action === "block" ? 403 : 202;
    res.status(httpStatus).json({
      success: false,
      guardrail: true,
      action: guardrail.action,
      ruleId: guardrail.ruleId,
      message: guardrail.message,
    });
    return;
  }

  const auditStart = Date.now();

  try {
    // Per-request client using the caller's token — no shared auth context needed
    const client = Client.init({
      authProvider: (done) => done(null, token),
    });

    let request = client.api(apiPath).version(graphApiVersion);
    if (queryParams && Object.keys(queryParams).length > 0) {
      request = request.query(queryParams);
    }

    let data: unknown;
    switch (method.toLowerCase()) {
      case "get":    data = await request.get(); break;
      case "post":   data = await request.post(body ?? {}); break;
      case "put":    data = await request.put(body ?? {}); break;
      case "patch":  data = await request.patch(body ?? {}); break;
      case "delete":
        data = await request.delete();
        if (data == null) data = { status: "No Content" };
        break;
      default:
        res.status(400).json({ success: false, error: `Unsupported method: ${method}` });
        return;
    }

    logger.info({
      event: "rest_call",
      method: method.toUpperCase(),
      path: apiPath,
      success: true,
      duration_ms: Date.now() - auditStart,
    }, "REST /api/graph completed");

    res.json({ success: true, data });
  } catch (error: any) {
    logger.error({
      event: "rest_call",
      method: method.toUpperCase(),
      path: apiPath,
      success: false,
      duration_ms: Date.now() - auditStart,
      err: { message: error.message, statusCode: error.statusCode },
    }, "REST /api/graph failed");

    res.status(error.statusCode ?? 500).json({
      success: false,
      error: error.message ?? "Internal server error",
      statusCode: error.statusCode,
    });
  }
}

// ---------------------------------------------------------------------------
// HTTP transport entry point
// ---------------------------------------------------------------------------
export async function startHttpTransport(
  createServer: ServerFactory,
  ctx: AuthCtx,
): Promise<void> {
  const port = config.ELIGRAPH_HTTP_PORT;
  const host = config.ELIGRAPH_HTTP_HOST;

  const app = express();
  app.use(express.json());
  app.use(corsMiddleware);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // REST endpoint for Power Platform custom connector
  app.post("/api/graph", handleGraphRest);

  // Session map: session ID -> transport
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.all("/mcp", async (req, res) => {
    const raw = req.headers["mcp-session-id"];
    const sessionId: string | undefined = Array.isArray(raw) ? raw[0] : raw;

    if (sessionId) {
      const transport = sessions.get(sessionId);
      if (transport) {
        await transport.handleRequest(req, res, req.body);
        return;
      }
    }

    if (req.method !== "POST") {
      res.status(400).json({ error: "Missing or unknown Mcp-Session-Id" });
      return;
    }

    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
        logger.info(`HTTP session initialised: ${id}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        logger.info(`HTTP session closed: ${transport.sessionId}`);
      }
    };

    const server = createServer(ctx);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  await new Promise<void>((resolve, reject) => {
    app.listen(port, host, () => {
      logger.info(`EliGraph HTTP transport listening on http://${host}:${port}/mcp`);
      resolve();
    }).on("error", reject);
  });
}
