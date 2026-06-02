import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .or(z.boolean());

const envSchema = z.object({
  // Transport
  ELIGRAPH_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  ELIGRAPH_HTTP_PORT: z
    .string()
    .default("3000")
    .transform((v) => parseInt(v, 10))
    .refine((n) => !Number.isNaN(n) && n >= 1 && n <= 65535, {
      message: "ELIGRAPH_HTTP_PORT must be an integer between 1 and 65535",
    }),
  ELIGRAPH_HTTP_HOST: z.string().default("127.0.0.1"),

  // Logging
  ELIGRAPH_LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error"])
    .default("info"),

  // Security
  ELIGRAPH_ALLOW_APP_ONLY: booleanFromString.default("false"),

  // Auth modes (mutually exclusive — validated in main)
  USE_CLIENT_TOKEN: booleanFromString.default("false"),
  USE_INTERACTIVE: booleanFromString.default("false"),
  USE_CERTIFICATE: booleanFromString.default("false"),

  // Microsoft identity
  TENANT_ID: z.string().optional(),
  CLIENT_ID: z.string().optional(),
  CLIENT_SECRET: z.string().optional(),
  ACCESS_TOKEN: z.string().optional(),
  REDIRECT_URI: z.string().optional(),
  CERTIFICATE_PATH: z.string().optional(),
  CERTIFICATE_PASSWORD: z.string().optional(),

  // Graph
  USE_GRAPH_BETA: booleanFromString.default("true"),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Use process.stderr directly — logger may not be initialised yet
    process.stderr.write(
      `[ELIGRAPH] FATAL: Invalid environment configuration:\n${issues}\n`,
    );
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
