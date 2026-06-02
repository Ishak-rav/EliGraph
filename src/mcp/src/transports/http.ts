import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "../logger.js";
import type { AuthCtx, ServerFactory } from "../types.js";

export async function startHttpTransport(
  createServer: ServerFactory,
  ctx: AuthCtx,
): Promise<void> {
  const port = parseInt(process.env.ELIGRAPH_HTTP_PORT ?? "3000", 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ELIGRAPH_HTTP_PORT: "${process.env.ELIGRAPH_HTTP_PORT}". Must be an integer between 1 and 65535.`);
  }
  const host = process.env.ELIGRAPH_HTTP_HOST ?? "127.0.0.1";

  const app = express();
  app.use(express.json());

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
