#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client, PageIterator, PageCollection } from "@microsoft/microsoft-graph-client";
import fetch from 'isomorphic-fetch'; // Required polyfill for Graph client
import { config } from "./config/env.js";
import { logger } from "./logger.js";
import { AuthManager, AuthConfig, AuthMode } from "./auth.js";
import { EliGraphClientId, EliGraphDefaultTenantId, EliGraphDefaultRedirectUri, getDefaultGraphApiVersion } from "./constants.js";
import { startHttpTransport } from "./transports/http.js";
import type { AuthCtx, ServerFactory } from "./types.js";

// Set up global fetch for the Microsoft Graph client
(global as any).fetch = fetch;

const useGraphBeta = config.USE_GRAPH_BETA;
const defaultGraphApiVersion = getDefaultGraphApiVersion();

// ---------------------------------------------------------------------------
// Server factory — creates a fully configured McpServer bound to an AuthCtx.
// Each HTTP session calls this to get its own McpServer instance while sharing
// the same auth context (auth is configured once from env vars).
// ---------------------------------------------------------------------------
export function buildServer(ctx: AuthCtx): McpServer {
  const server = new McpServer({
    name: "EliGraph-Microsoft",
    version: "0.1.0",
  });

  server.tool(
    "EliGraph-Microsoft",
    "A versatile tool to interact with Microsoft APIs including Microsoft Graph (Entra) and Azure Resource Management. IMPORTANT: For Graph API GET requests using advanced query parameters ($filter, $count, $search, $orderby), you are ADVISED to set 'consistencyLevel: \"eventual\"'.",
    {
      apiType: z.enum(["graph", "azure"]).describe("Type of Microsoft API to query. Options: 'graph' for Microsoft Graph (Entra) or 'azure' for Azure Resource Management."),
      path: z.string().describe("The Azure or Graph API URL path to call (e.g. '/users', '/groups', '/subscriptions')"),
      method: z.enum(["get", "post", "put", "patch", "delete"]).describe("HTTP method to use"),
      apiVersion: z.string().optional().describe("Azure Resource Management API version (required for apiType Azure)"),
      subscriptionId: z.string().optional().describe("Azure Subscription ID (for Azure Resource Management)."),
      queryParams: z.record(z.string(), z.string()).optional().describe("Query parameters for the request"),
      body: z.record(z.string(), z.any()).optional().describe("The request body (for POST, PUT, PATCH)"),
      graphApiVersion: z.enum(["v1.0", "beta"]).optional().default(defaultGraphApiVersion as "v1.0" | "beta").describe(`Microsoft Graph API version to use (default: ${defaultGraphApiVersion})`),
      fetchAll: z.boolean().optional().default(false).describe("Set to true to automatically fetch all pages for list results (e.g., users, groups). Default is false."),
      consistencyLevel: z.string().optional().describe("Graph API ConsistencyLevel header. ADVISED to be set to 'eventual' for Graph GET requests using advanced query parameters ($filter, $count, $search, $orderby)."),
    },
    async ({
      apiType,
      path,
      method,
      apiVersion,
      subscriptionId,
      queryParams,
      body,
      graphApiVersion,
      fetchAll,
      consistencyLevel,
    }: {
      apiType: "graph" | "azure";
      path: string;
      method: "get" | "post" | "put" | "patch" | "delete";
      apiVersion?: string;
      subscriptionId?: string;
      queryParams?: Record<string, string>;
      body?: any;
      graphApiVersion: "v1.0" | "beta";
      fetchAll: boolean;
      consistencyLevel?: string;
    }) => {
      const effectiveGraphApiVersion = !useGraphBeta ? "v1.0" : graphApiVersion;

      logger.info(`Executing EliGraph-Microsoft tool with params: apiType=${apiType}, path=${path}, method=${method}, graphApiVersion=${effectiveGraphApiVersion}, fetchAll=${fetchAll}, consistencyLevel=${consistencyLevel}`);
      let determinedUrl: string | undefined;

      try {
        let responseData: any;

        if (apiType === 'graph') {
          if (!ctx.graphClient) {
            throw new Error("Graph client not initialized");
          }
          determinedUrl = `https://graph.microsoft.com/${effectiveGraphApiVersion}`;

          let request = ctx.graphClient.api(path).version(effectiveGraphApiVersion);

          if (queryParams && Object.keys(queryParams).length > 0) {
            request = request.query(queryParams);
          }

          if (consistencyLevel) {
            request = request.header('ConsistencyLevel', consistencyLevel);
            logger.info(`Added ConsistencyLevel header: ${consistencyLevel}`);
          }

          switch (method.toLowerCase()) {
            case 'get':
              if (fetchAll) {
                logger.info(`Fetching all pages for Graph path: ${path}`);
                const firstPageResponse: PageCollection = await request.get();
                const odataContext = firstPageResponse['@odata.context'];
                let allItems: any[] = firstPageResponse.value || [];

                const callback = (item: any) => {
                  allItems.push(item);
                  return true;
                };

                const pageIterator = new PageIterator(ctx.graphClient, firstPageResponse, callback);
                await pageIterator.iterate();

                responseData = { '@odata.context': odataContext, value: allItems };
                logger.info(`Finished fetching all Graph pages. Total items: ${allItems.length}`);
              } else {
                logger.info(`Fetching single page for Graph path: ${path}`);
                responseData = await request.get();
              }
              break;
            case 'post':
              responseData = await request.post(body ?? {});
              break;
            case 'put':
              responseData = await request.put(body ?? {});
              break;
            case 'patch':
              responseData = await request.patch(body ?? {});
              break;
            case 'delete':
              responseData = await request.delete();
              if (responseData === undefined || responseData === null) {
                responseData = { status: "Success (No Content)" };
              }
              break;
            default:
              throw new Error(`Unsupported method: ${method}`);
          }
        } else {
          if (!ctx.authManager) {
            throw new Error("Auth manager not initialized");
          }
          determinedUrl = "https://management.azure.com";

          const azureCredential = ctx.authManager.getAzureCredential();
          const tokenResponse = await azureCredential.getToken("https://management.azure.com/.default");
          if (!tokenResponse || !tokenResponse.token) {
            throw new Error("Failed to acquire Azure access token");
          }

          let url = determinedUrl;
          if (subscriptionId) {
            url += `/subscriptions/${subscriptionId}`;
          }
          url += path;

          if (!apiVersion) {
            throw new Error("API version is required for Azure Resource Management queries");
          }
          const urlParams = new URLSearchParams({ 'api-version': apiVersion });
          if (queryParams) {
            for (const [key, value] of Object.entries(queryParams)) {
              urlParams.append(String(key), String(value));
            }
          }
          url += `?${urlParams.toString()}`;

          const headers: Record<string, string> = {
            'Authorization': `Bearer ${tokenResponse.token}`,
            'Content-Type': 'application/json',
          };
          const requestOptions: RequestInit = { method: method.toUpperCase(), headers };
          if (["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
            requestOptions.body = body ? JSON.stringify(body) : JSON.stringify({});
          }

          if (fetchAll && method === 'get') {
            logger.info(`Fetching all pages for Azure RM starting from: ${url}`);
            let allValues: any[] = [];
            let currentUrl: string | null = url;

            while (currentUrl) {
              logger.info(`Fetching Azure RM page: ${currentUrl}`);
              const azureCred = ctx.authManager.getAzureCredential();
              const pageToken = await azureCred.getToken("https://management.azure.com/.default");
              if (!pageToken || !pageToken.token) {
                throw new Error("Failed to acquire Azure access token during pagination");
              }
              const pageHeaders = { ...headers, 'Authorization': `Bearer ${pageToken.token}` };
              const pageResponse = await fetch(currentUrl, { method: 'GET', headers: pageHeaders });
              const pageText = await pageResponse.text();
              let pageData: any;
              try {
                pageData = pageText ? JSON.parse(pageText) : {};
              } catch {
                pageData = { rawResponse: pageText };
              }
              if (!pageResponse.ok) {
                throw new Error(`API error (${pageResponse.status}) during Azure RM pagination: ${JSON.stringify(pageData)}`);
              }
              if (pageData.value && Array.isArray(pageData.value)) {
                allValues = allValues.concat(pageData.value);
              } else if (currentUrl === url && !pageData.nextLink) {
                allValues.push(pageData);
              }
              currentUrl = pageData.nextLink || null;
            }
            responseData = { allValues };
            logger.info(`Finished fetching all Azure RM pages. Total items: ${allValues.length}`);
          } else {
            logger.info(`Fetching single page for Azure RM: ${url}`);
            const apiResponse = await fetch(url, requestOptions);
            const responseText = await apiResponse.text();
            try {
              responseData = responseText ? JSON.parse(responseText) : {};
            } catch {
              responseData = { rawResponse: responseText };
            }
            if (!apiResponse.ok) {
              throw new Error(`API error (${apiResponse.status}) for Azure RM: ${JSON.stringify(responseData)}`);
            }
          }
        }

        let resultText = `Result for ${apiType} API (${apiType === 'graph' ? effectiveGraphApiVersion : apiVersion}) - ${method} ${path}:\n\n`;
        resultText += JSON.stringify(responseData, null, 2);

        if (!fetchAll && method === 'get') {
          const nextLinkKey = apiType === 'graph' ? '@odata.nextLink' : 'nextLink';
          if (responseData && responseData[nextLinkKey]) {
            resultText += `\n\nNote: More results are available. To retrieve all pages, add the parameter 'fetchAll: true' to your request.`;
          }
        }

        return { content: [{ type: "text" as const, text: resultText }] };
      } catch (error: any) {
        logger.error(`Error in EliGraph-Microsoft tool (apiType: ${apiType}, path: ${path}, method: ${method}):`, error);
        if (!determinedUrl) {
          determinedUrl = apiType === 'graph'
            ? `https://graph.microsoft.com/${effectiveGraphApiVersion}`
            : "https://management.azure.com";
        }
        const errorBody = error.body ? (typeof error.body === 'string' ? error.body : JSON.stringify(error.body)) : 'N/A';
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              statusCode: error.statusCode || 'N/A',
              errorBody,
              attemptedBaseUrl: determinedUrl,
            }),
          }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "set-access-token",
    "Set or update the access token for Microsoft Graph authentication. Use this when the MCP Client has obtained a fresh token through interactive authentication.",
    {
      accessToken: z.string().describe("The access token obtained from Microsoft Graph authentication"),
      expiresOn: z.string().optional().describe("Token expiration time in ISO format (optional, defaults to 1 hour from now)"),
    },
    async ({ accessToken, expiresOn }: { accessToken: string; expiresOn?: string }) => {
      try {
        const expirationDate = expiresOn ? new Date(expiresOn) : undefined;

        if (ctx.authManager?.getAuthMode() === AuthMode.ClientProvidedToken) {
          ctx.authManager.updateAccessToken(accessToken, expirationDate);

          const authProvider = ctx.authManager.getGraphAuthProvider();
          ctx.graphClient = Client.initWithMiddleware({ authProvider });

          return {
            content: [{
              type: "text" as const,
              text: "Access token updated successfully. You can now make Microsoft Graph requests on behalf of the authenticated user.",
            }],
          };
        } else {
          return {
            content: [{
              type: "text" as const,
              text: "Error: MCP Server is not configured for client-provided token authentication. Set USE_CLIENT_TOKEN=true in environment variables.",
            }],
            isError: true,
          };
        }
      } catch (error: any) {
        logger.error("Error setting access token:", error);
        return {
          content: [{ type: "text" as const, text: `Error setting access token: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get-auth-status",
    "Check the current authentication status and mode of the MCP Server and also returns the current graph permission scopes of the access token for the current session.",
    {},
    async () => {
      try {
        const authMode = ctx.authManager?.getAuthMode() || "Not initialized";
        const isReady = ctx.authManager !== null;
        const tokenStatus = ctx.authManager ? await ctx.authManager.getTokenStatus() : { isExpired: false };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ authMode, isReady, supportsTokenUpdates: authMode === AuthMode.ClientProvidedToken, tokenStatus, timestamp: new Date().toISOString() }, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error checking auth status: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "add-graph-permission",
    "Request additional Microsoft Graph permission scopes by performing a fresh interactive sign-in. This tool only works in interactive authentication mode and should be used if any Graph API call returns permissions related errors.",
    {
      scopes: z.array(z.string()).describe("Array of Microsoft Graph permission scopes to request (e.g., ['User.Read', 'Mail.ReadWrite', 'Directory.Read.All'])"),
    },
    async ({ scopes }: { scopes: string[] }) => {
      try {
        if (!ctx.authManager || ctx.authManager.getAuthMode() !== AuthMode.Interactive) {
          const currentMode = ctx.authManager?.getAuthMode() || "Not initialized";
          const clientId = process.env.CLIENT_ID;
          let errorMessage = `Error: add-graph-permission tool is only available in interactive authentication mode. Current mode: ${currentMode}.\n\n`;

          if (currentMode === AuthMode.ClientCredentials) {
            errorMessage += `To add permissions in Client Credentials mode:\n`;
            errorMessage += `1. Open the Microsoft Entra admin center (https://entra.microsoft.com)\n`;
            errorMessage += `2. Navigate to Applications > App registrations\n`;
            errorMessage += `3. Find your application${clientId ? ` (Client ID: ${clientId})` : ''}\n`;
            errorMessage += `4. Go to API permissions and add: ${scopes.join(', ')}\n`;
            errorMessage += `5. Click "Grant admin consent" then restart the server.`;
          } else if (currentMode === AuthMode.ClientProvidedToken) {
            errorMessage += `To add permissions in Client Provided Token mode:\n`;
            errorMessage += `1. Obtain a new token including: ${scopes.join(', ')}\n`;
            errorMessage += `2. Use the set-access-token tool to update the server.`;
          } else {
            errorMessage += `Set USE_INTERACTIVE=true and restart the server.`;
          }

          return { content: [{ type: "text" as const, text: errorMessage }], isError: true };
        }

        if (!scopes || scopes.length === 0) {
          return { content: [{ type: "text" as const, text: "Error: At least one permission scope must be specified." }], isError: true };
        }

        const invalidScopes = scopes.filter(s => !s.includes('.') || s.trim() !== s);
        if (invalidScopes.length > 0) {
          return {
            content: [{ type: "text" as const, text: `Error: Invalid scope format: ${invalidScopes.join(', ')}. Use format like 'User.Read'.` }],
            isError: true,
          };
        }

        logger.info(`Requesting additional Graph permissions: ${scopes.join(', ')}`);

        const tenantId = process.env.TENANT_ID || EliGraphDefaultTenantId;
        const clientId = process.env.CLIENT_ID || EliGraphClientId;
        const redirectUri = process.env.REDIRECT_URI || EliGraphDefaultRedirectUri;

        const { InteractiveBrowserCredential, DeviceCodeCredential } = await import("@azure/identity");

        const scopeString = scopes.map(s => `https://graph.microsoft.com/${s}`).join(' ');
        logger.info(`Requesting fresh token with scopes: ${scopeString}`);

        let newCredential;
        let tokenResponse;

        try {
          newCredential = new InteractiveBrowserCredential({ tenantId, clientId, redirectUri });
          tokenResponse = await newCredential.getToken(scopeString);
        } catch {
          logger.info("Interactive browser failed, falling back to device code flow");
          newCredential = new DeviceCodeCredential({
            tenantId,
            clientId,
            userPromptCallback: (info) => {
              logger.info(`Device code authentication — visit: ${info.verificationUri} and enter: ${info.userCode}`);
              return Promise.resolve();
            },
          });
          tokenResponse = await newCredential.getToken(scopeString);
        }

        if (!tokenResponse) {
          return {
            content: [{ type: "text" as const, text: "Error: Failed to acquire access token with the requested scopes." }],
            isError: true,
          };
        }

        const authConfig: AuthConfig = { mode: AuthMode.Interactive, tenantId, clientId, redirectUri };
        const newAuthManager = new AuthManager(authConfig);
        (newAuthManager as any).credential = newCredential;

        const authProvider = newAuthManager.getGraphAuthProvider();
        const newGraphClient = Client.initWithMiddleware({ authProvider });

        // Atomic swap: keep old context alive until new one is fully ready,
        // so concurrent HTTP sessions don't see a null authManager window.
        ctx.authManager = newAuthManager;
        ctx.graphClient = newGraphClient;

        const tokenStatus = await ctx.authManager.getTokenStatus();
        logger.info(`Successfully acquired fresh token with scopes: ${scopes.join(', ')}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              message: "Successfully acquired additional Microsoft Graph permissions",
              requestedScopes: scopes,
              tokenStatus,
              timestamp: new Date().toISOString(),
            }, null, 2),
          }],
        };
      } catch (error: any) {
        logger.error("Error requesting additional Graph permissions:", error);
        return {
          content: [{ type: "text" as const, text: `Error requesting additional permissions: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const { USE_CLIENT_TOKEN, USE_INTERACTIVE, USE_CERTIFICATE } = config;

  const enabledModes = [USE_CLIENT_TOKEN, USE_INTERACTIVE, USE_CERTIFICATE].filter(Boolean);
  if (enabledModes.length > 1) {
    throw new Error("Multiple authentication modes enabled. Please enable only one of USE_CLIENT_TOKEN, USE_INTERACTIVE, or USE_CERTIFICATE.");
  }

  let authMode: AuthMode;

  if (USE_CLIENT_TOKEN) {
    authMode = AuthMode.ClientProvidedToken;
  } else if (USE_INTERACTIVE) {
    authMode = AuthMode.Interactive;
  } else if (USE_CERTIFICATE) {
    authMode = AuthMode.Certificate;
  } else {
    const hasClientCredentials = config.TENANT_ID && config.CLIENT_ID && config.CLIENT_SECRET;
    if (hasClientCredentials) {
      authMode = AuthMode.ClientCredentials;
    } else {
      authMode = AuthMode.Interactive;
      logger.info("No authentication mode specified. Defaulting to interactive mode.");
    }
  }

  // Guard: refuse app-only unless operator explicitly opts in
  if (authMode === AuthMode.ClientCredentials && !config.ELIGRAPH_ALLOW_APP_ONLY) {
    process.stderr.write(
      "[ELIGRAPH] FATAL: App-only authentication (CLIENT_SECRET without OBO) is disabled by default.\n" +
      "Set ELIGRAPH_ALLOW_APP_ONLY=true to opt in explicitly.\n" +
      "See ARCHITECTURE.md §8 for details.\n",
    );
    process.exit(1);
  }

  logger.info(`Starting with authentication mode: ${authMode}`);

  let tenantId: string | undefined;
  let clientId: string | undefined;

  if (authMode === AuthMode.Interactive) {
    tenantId = config.TENANT_ID ?? EliGraphDefaultTenantId;
    clientId = config.CLIENT_ID ?? EliGraphClientId;
    logger.info(`Interactive mode using tenant ID: ${tenantId}, client ID: ${clientId}`);
  } else {
    tenantId = config.TENANT_ID;
    clientId = config.CLIENT_ID;
  }

  if (authMode === AuthMode.ClientCredentials) {
    if (!tenantId || !clientId || !config.CLIENT_SECRET) {
      throw new Error("Client credentials mode requires TENANT_ID, CLIENT_ID, and CLIENT_SECRET");
    }
  } else if (authMode === AuthMode.Certificate) {
    if (!tenantId || !clientId || !config.CERTIFICATE_PATH) {
      throw new Error("Certificate mode requires TENANT_ID, CLIENT_ID, and CERTIFICATE_PATH");
    }
  }

  const authConfig: AuthConfig = {
    mode: authMode,
    tenantId,
    clientId,
    clientSecret: config.CLIENT_SECRET,
    accessToken: config.ACCESS_TOKEN,
    redirectUri: config.REDIRECT_URI,
    certificatePath: config.CERTIFICATE_PATH,
    certificatePassword: config.CERTIFICATE_PASSWORD,
  };

  // Shared auth context — all sessions (HTTP or stdio) read from this object
  const ctx: AuthCtx = { authManager: null, graphClient: null };

  ctx.authManager = new AuthManager(authConfig);

  if (authMode !== AuthMode.ClientProvidedToken || config.ACCESS_TOKEN) {
    await ctx.authManager.initialize();
    const authProvider = ctx.authManager.getGraphAuthProvider();
    ctx.graphClient = Client.initWithMiddleware({ authProvider });
    logger.info(`Authentication initialised successfully (mode: ${authMode})`);
  } else {
    logger.info("Started in client-token mode. Use set-access-token tool to authenticate.");
  }

  logger.info(`EliGraph starting — transport: ${config.ELIGRAPH_TRANSPORT}`);

  if (config.ELIGRAPH_TRANSPORT === "http") {
    const createServer: ServerFactory = (c) => buildServer(c);
    await startHttpTransport(createServer, ctx);
  } else {
    const server = buildServer(ctx);
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  }
}

main().catch((error) => {
  logger.error("Fatal error in main()", error);
  process.exit(1);
});
