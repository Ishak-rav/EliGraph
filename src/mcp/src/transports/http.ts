import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "../config/env.js";
import { logger } from "../logger.js";
import type { AuthCtx, ServerFactory } from "../types.js";

export async function startHttpTransport(
  createServer: ServerFactory,
  ctx: AuthCtx,
): Promise<void> {
  const port = config.ELIGRAPH_HTTP_PORT;
  const host = config.ELIGRAPH_HTTP_HOST;

  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

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
      // GET/DELETE without valid session ID
      res.status(400).json({ error: "Missing or unknown Mcp-Session-Id" });
      return;
    }

    // New session — one McpServer + one transport per session
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
