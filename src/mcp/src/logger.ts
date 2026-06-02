import pino from "pino";
import { config } from "./config/env.js";

// Paths whose values must never appear in logs (tokens, secrets, passwords).
const REDACTED_PATHS = [
  "Authorization",
  "authorization",
  "*.Authorization",
  "*.authorization",
  "accessToken",
  "*.accessToken",
  "token",
  "*.token",
  "*.secret",
  "*.password",
  "*.clientSecret",
  "CLIENT_SECRET",
];

function buildTransport():
  | pino.TransportSingleOptions
  | pino.TransportMultiOptions
  | undefined {
  if (!config.ELIGRAPH_AUDIT_FILE) {
    return undefined; // pino writes to stdout by default
  }

  // Dual output: stdout + append to audit file
  return {
    targets: [
      {
        target: "pino/file",
        options: { destination: 1 },
        level: config.ELIGRAPH_LOG_LEVEL,
      },
      {
        target: "pino/file",
        options: { destination: config.ELIGRAPH_AUDIT_FILE, mkdir: true },
        level: config.ELIGRAPH_LOG_LEVEL,
      },
    ],
  };
}

export const logger = pino({
  level: config.ELIGRAPH_LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
  transport: buildTransport(),
});
