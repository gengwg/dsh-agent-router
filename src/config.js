/**
 * Plugin configuration schema.
 *
 * Implemented as a dependency-free Standard Schema v1 object so that Cordis
 * validates the profile entry at load time (`resolveConfig`) and a malformed
 * rule fails the plugin loudly, instead of throwing on the first delegation.
 *
 *   rules:
 *     - name: research              # optional label used in decisions
 *       keywords: [investigate]     # case-insensitive substrings; first match wins
 *       route:
 *         provider: openrouter
 *         model: some/model
 *         reasoningEffort: high     # optional
 *       overrideExplicit: false     # optional; replace an explicit caller route
 */

const RULE_KEYS = new Set(['name', 'keywords', 'route', 'overrideExplicit']);
const ROUTE_KEYS = new Set(['provider', 'model', 'reasoningEffort']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateRoute(route, path, issues) {
  if (!isPlainObject(route)) {
    issues.push({ path, message: 'route must be an object with provider and model' });
    return undefined;
  }
  for (const key of Object.keys(route)) {
    if (!ROUTE_KEYS.has(key)) {
      issues.push({ path: [...path, key], message: `unknown route key; allowed: ${[...ROUTE_KEYS].join(', ')}` });
    }
  }
  if (!nonEmptyString(route.provider)) {
    issues.push({ path: [...path, 'provider'], message: 'provider must be a non-empty string' });
  }
  if (!nonEmptyString(route.model)) {
    issues.push({ path: [...path, 'model'], message: 'model must be a non-empty string' });
  }
  if (route.reasoningEffort !== undefined && !nonEmptyString(route.reasoningEffort)) {
    issues.push({ path: [...path, 'reasoningEffort'], message: 'reasoningEffort must be a non-empty string' });
  }
  const out = { provider: route.provider, model: route.model };
  if (route.reasoningEffort !== undefined) out.reasoningEffort = route.reasoningEffort;
  return out;
}

function validateRule(rule, path, issues) {
  if (!isPlainObject(rule)) {
    issues.push({ path, message: 'rule must be an object with keywords and route' });
    return undefined;
  }
  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.has(key)) {
      issues.push({ path: [...path, key], message: `unknown rule key; allowed: ${[...RULE_KEYS].join(', ')}` });
    }
  }
  if (
    !Array.isArray(rule.keywords) ||
    rule.keywords.length === 0 ||
    !rule.keywords.every(nonEmptyString)
  ) {
    issues.push({ path: [...path, 'keywords'], message: 'keywords must be a non-empty array of non-empty strings' });
  }
  if (rule.name !== undefined && !nonEmptyString(rule.name)) {
    issues.push({ path: [...path, 'name'], message: 'name must be a non-empty string' });
  }
  if (rule.overrideExplicit !== undefined && typeof rule.overrideExplicit !== 'boolean') {
    issues.push({ path: [...path, 'overrideExplicit'], message: 'overrideExplicit must be a boolean' });
  }
  const route = validateRoute(rule.route, [...path, 'route'], issues);
  const out = { keywords: Array.isArray(rule.keywords) ? [...rule.keywords] : [], route };
  if (rule.name !== undefined) out.name = rule.name;
  if (rule.overrideExplicit !== undefined) out.overrideExplicit = rule.overrideExplicit;
  return out;
}

function validate(value) {
  const issues = [];
  if (value === undefined || value === null) value = {};
  if (!isPlainObject(value)) {
    return { issues: [{ path: [], message: 'config must be an object' }] };
  }
  for (const key of Object.keys(value)) {
    if (key !== 'rules') issues.push({ path: [key], message: 'unknown config key; allowed: rules' });
  }
  const rawRules = value.rules ?? [];
  if (!Array.isArray(rawRules)) {
    issues.push({ path: ['rules'], message: 'rules must be an array' });
    return { issues };
  }
  const rules = rawRules.map((rule, i) => validateRule(rule, ['rules', i], issues));
  if (issues.length > 0) return { issues };
  return { value: { rules } };
}

export const Config = {
  '~standard': { version: 1, vendor: 'dsh-agent-router', validate },
};

/** Validate and normalize; throws a TypeError listing every issue. */
export function validateConfig(value) {
  const result = validate(value);
  if (result.issues) {
    const lines = result.issues.map((issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`);
    throw new TypeError(`dsh-agent-router: invalid config\n${lines.join('\n')}`);
  }
  return result.value;
}
