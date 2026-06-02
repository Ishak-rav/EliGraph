import { logger } from "../logger.js";
import { defaultRules } from "./rules.js";
import type { GuardrailContext, GuardrailResult, GuardrailRule } from "./types.js";

function matchesRule(rule: GuardrailRule, ctx: GuardrailContext): boolean {
  const { match } = rule;

  if (match.apiType && match.apiType !== ctx.apiType) return false;

  if (match.methods && !match.methods.includes(ctx.method.toUpperCase())) return false;

  if (match.pathPattern && !new RegExp(match.pathPattern, "i").test(ctx.path)) return false;

  if (match.bodyPattern) {
    const bodyJson = ctx.body ? JSON.stringify(ctx.body) : "";
    if (!new RegExp(match.bodyPattern, "i").test(bodyJson)) return false;
  }

  if (match.bodyArrayMinSize !== undefined) {
    const members = ctx.body?.["members"] ?? ctx.body?.["value"];
    const size = Array.isArray(members) ? members.length : 0;
    if (size <= match.bodyArrayMinSize) return false;
  }

  return true;
}

export function evaluate(ctx: GuardrailContext, confirmed: boolean): GuardrailResult {
  for (const rule of defaultRules) {
    if (!matchesRule(rule, ctx)) continue;

    if (rule.action === "warn") {
      logger.warn(
        { event: "guardrail_warn", rule_id: rule.id, api_type: ctx.apiType, method: ctx.method, path: ctx.path },
        rule.description,
      );
      continue; // non-blocking, continue evaluating
    }

    if (rule.action === "block") {
      logger.warn(
        { event: "guardrail_block", rule_id: rule.id, api_type: ctx.apiType, method: ctx.method, path: ctx.path },
        rule.description,
      );
      return {
        allowed: false,
        action: "block",
        ruleId: rule.id,
        message: rule.message ?? `Blocked by guardrail [${rule.id}]: ${rule.description}`,
      };
    }

    if (rule.action === "require_confirmation") {
      if (!confirmed) {
        logger.info(
          { event: "guardrail_confirmation_required", rule_id: rule.id, api_type: ctx.apiType, method: ctx.method, path: ctx.path },
          rule.description,
        );
        return {
          allowed: false,
          action: "require_confirmation",
          ruleId: rule.id,
          message:
            `⚠️ Guardrail [${rule.id}]: ${rule.description}\n` +
            `Operation: ${ctx.method.toUpperCase()} ${ctx.path}\n` +
            `Call again with confirm: true to proceed.`,
        };
      }
      // confirmed — log the bypass and continue
      logger.info(
        { event: "guardrail_bypassed", rule_id: rule.id, api_type: ctx.apiType, method: ctx.method, path: ctx.path },
        "Guardrail bypassed with confirm:true",
      );
    }
  }

  return { allowed: true };
}
