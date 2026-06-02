import type { GuardrailRule } from "./types.js";

// Default guardrail rules.
// All rules are evaluated in order; first matching block/require_confirmation wins.
// Warn rules are non-blocking: they log and continue evaluation.
export const defaultRules: GuardrailRule[] = [
  // ------------------------------------------------------------------
  // Hard blocks — no bypass possible
  // ------------------------------------------------------------------
  {
    id: "block-privileged-groups",
    description: "Block write operations targeting known privileged admin groups",
    match: {
      apiType: "graph",
      methods: ["POST", "PATCH", "PUT", "DELETE"],
      bodyPattern: "(tenant.?admins|global.?admins|company.?admins|privileged.?role.?admins)",
    },
    action: "block",
    message:
      "Write operations targeting privileged admin groups are blocked by EliGraph guardrails. " +
      "Contact your administrator if this is intentional.",
  },

  // ------------------------------------------------------------------
  // Confirmation required — caller must re-invoke with confirm: true
  // ------------------------------------------------------------------
  {
    id: "confirm-delete-user",
    description: "Require confirmation before deleting a user object",
    match: {
      apiType: "graph",
      methods: ["DELETE"],
      pathPattern: "^/users/[^/]+$",
    },
    action: "require_confirmation",
  },
  {
    id: "confirm-delete-group",
    description: "Require confirmation before deleting a group",
    match: {
      apiType: "graph",
      methods: ["DELETE"],
      pathPattern: "^/groups/[^/]+$",
    },
    action: "require_confirmation",
  },
  {
    id: "confirm-bulk-group-members",
    description: "Require confirmation when adding more than 50 members to a group at once",
    match: {
      apiType: "graph",
      methods: ["POST"],
      pathPattern: "^/groups/[^/]+/members",
      bodyArrayMinSize: 50,
    },
    action: "require_confirmation",
  },
  {
    id: "confirm-group-members-write",
    description: "Require confirmation before modifying group membership",
    match: {
      apiType: "graph",
      methods: ["POST", "DELETE"],
      pathPattern: "^/groups/[^/]+/members",
    },
    action: "require_confirmation",
  },
  {
    id: "confirm-delete-azure-resource",
    description: "Require confirmation before deleting any Azure resource",
    match: {
      apiType: "azure",
      methods: ["DELETE"],
    },
    action: "require_confirmation",
  },

  // ------------------------------------------------------------------
  // Warnings — logged but never block execution
  // ------------------------------------------------------------------
  {
    id: "warn-user-profile-edit",
    description: "Log a warning when a user profile is modified",
    match: {
      apiType: "graph",
      methods: ["PATCH", "PUT"],
      pathPattern: "^/users/[^/]+$",
    },
    action: "warn",
  },
  {
    id: "warn-role-assignment",
    description: "Log a warning when directory role assignments are changed",
    match: {
      apiType: "graph",
      methods: ["POST", "DELETE"],
      pathPattern: "^/directoryRoles/",
    },
    action: "warn",
  },
];
