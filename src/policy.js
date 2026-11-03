/**
 * Pure routing policy for delegation-time decisions.
 *
 * Deterministic by construction: first matching rule in config order wins,
 * matching is case-insensitive substring over the delegation label and prompt
 * text, and no rule rewrites an explicit caller route unless it opts in via
 * `overrideExplicit`. There is no fallback route: a delegation that no rule
 * claims proceeds unchanged through official DSH inheritance.
 */

/** Mirrors the official tool's route keys (provider/model/reasoningEffort). */
export function hasExplicitRoute(agentOptions) {
  return Boolean(
    agentOptions &&
      (agentOptions.provider || agentOptions.model || agentOptions.reasoningEffort),
  );
}

/** Accepts the tool's string or content-block prompt shapes. */
export function extractPromptText(prompt) {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block) =>
        block && typeof block === 'object' && typeof block.text === 'string'
          ? block.text
          : '',
      )
      .join('\n');
  }
  return '';
}

export function decide(rules, input) {
  if (rules.length === 0) {
    return { action: 'passthrough', reason: 'no-rules', rule: null, matchedKeyword: null };
  }
  const haystack = `${input.label ?? ''}\n${input.promptText ?? ''}`.toLowerCase();
  for (const rule of rules) {
    const keyword = rule.keywords.find(
      (k) => k.length > 0 && haystack.includes(k.toLowerCase()),
    );
    if (keyword === undefined) continue;
    if (hasExplicitRoute(input.requested) && !rule.overrideExplicit) {
      return {
        action: 'passthrough',
        reason: 'explicit-route-preserved',
        rule: rule.name,
        matchedKeyword: keyword,
      };
    }
    const agentOptions = {
      ...input.requested,
      provider: rule.route.provider,
      model: rule.route.model,
    };
    if (rule.route.reasoningEffort) {
      agentOptions.reasoningEffort = rule.route.reasoningEffort;
    } else {
      // A route change without an explicit effort must not carry the caller's
      // route-owned reasoning effort onto the new route.
      delete agentOptions.reasoningEffort;
    }
    return {
      action: 'route',
      reason: 'matched-rule',
      rule: rule.name,
      matchedKeyword: keyword,
      agentOptions,
    };
  }
  return { action: 'passthrough', reason: 'no-matching-rule', rule: null, matchedKeyword: null };
}
