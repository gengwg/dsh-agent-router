import { Config, validateConfig } from './config.js';
import { decide, extractPromptText } from './policy.js';

export * from './policy.js';
export { Config, validateConfig };

export const name = 'agent-router';
export const inject = ['subagents'];

/**
 * True when the delegation's provider is known to reject `agentOptions`
 * (out-of-process backends such as ACP advertise `capabilities.agentOptions:
 * false`). Routing such a delegation would turn it into an
 * UNSUPPORTED_CAPABILITY failure, so it passes through instead. Unknown
 * providers or hosts without `getProvider` are not held back.
 */
function providerRejectsAgentOptions(service, spec) {
  if (typeof service.getProvider !== 'function') return false;
  const provider = service.getProvider(spec.provider);
  return provider?.capabilities?.agentOptions === false;
}

export function apply(ctx, config = {}) {
  // Cordis already validated against `Config`; revalidating keeps direct
  // callers (tests, other hosts) on the same fail-loud path.
  const { rules } = validateConfig(config);
  const service = ctx.subagents;
  const startActivation = service.startActivation;
  ctx.effect(() => {
    const wrapped = async (spec) => {
      if (providerRejectsAgentOptions(service, spec)) return startActivation.call(service, spec);
      const decision = decide(rules, {
        label: spec.label,
        promptText: extractPromptText(spec.request?.prompt),
        requested: spec.request?.agentOptions,
      });
      if (decision.action === 'passthrough') return startActivation.call(service, spec);
      return startActivation.call(service, {
        ...spec,
        request: { ...spec.request, agentOptions: decision.agentOptions },
      });
    };
    service.startActivation = wrapped;
    return () => {
      // Only unwind our own layer. If another plugin wrapped on top of us,
      // restoring the original here would silently drop its wrapper.
      if (service.startActivation === wrapped) service.startActivation = startActivation;
    };
  }, 'dsh-agent-router');
}
