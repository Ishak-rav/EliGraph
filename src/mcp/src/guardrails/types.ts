export type GuardrailAction = "block" | "require_confirmation" | "warn";

export interface RuleMatch {
  apiType?: "graph" | "azure";
  methods?: string[];       // uppercase HTTP methods
  pathPattern?: string;     // regex applied case-insensitively against path
  bodyPattern?: string;     // regex applied case-insensitively against JSON.stringify(body)
  bodyArrayMinSize?: number; // fires if body.members || body.value is an array longer than N
}

export interface GuardrailRule {
  id: string;
  description: string;
  match: RuleMatch;
  action: GuardrailAction;
  message?: string;         // custom message shown to the caller
}

export interface GuardrailContext {
  apiType: "graph" | "azure";
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export type GuardrailResult =
  | { allowed: true }
  | { allowed: false; action: GuardrailAction; ruleId: string; message: string };
