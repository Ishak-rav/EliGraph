import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@microsoft/microsoft-graph-client";
import type { AuthManager } from "./auth.js";

export interface AuthCtx {
  authManager: AuthManager | null;
  graphClient: Client | null;
}

export type ServerFactory = (ctx: AuthCtx) => McpServer;
