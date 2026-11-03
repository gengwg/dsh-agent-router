# dsh-agent-router

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
picks a subagent's provider and model **once, at delegation time**, from a short
list of keyword rules you write. No classifier, no scoring: the first rule whose
keyword appears in the delegation label or prompt wins, and a delegation no rule
claims runs exactly as it would without the plugin.

It wraps the official `subagents.startActivation` service, so the child still
goes through DSH's own capacity, cancellation, result delivery, persistence and
cleanup. It registers no tools and changes nothing for the root agent.

## Install

Requires [pnpm](https://pnpm.io), which `dsh plugin` shells out to.

**From source:**

```sh
git clone https://github.com/gengwg/dsh-agent-router
cd dsh-agent-router
dsh plugin --profile web add "$PWD"
```

The package declares `dsh.bundle`, so `dsh plugin add` joins it to the profile's
bundle stack. Restart dsh to load it. It activates with an empty rule list, which
routes nothing.

## Configure

Rules live in the profile's `~/.dsh/profiles/<profile>/cordis.patch.yml` under the
`agent-router` entry. Each rule names the keywords that select it and the route to
apply:

```yaml
- id: agent-router
  name: dsh-agent-router
  config:
    rules:
      - name: research
        keywords: [investigate, research, compare]
        route:
          provider: openrouter
          model: deepseek/deepseek-v4-pro
          reasoningEffort: high
      - name: routine
        keywords: [typo, rename, format]
        route:
          provider: openrouter
          model: deepseek/deepseek-v4-flash
```

| Field | Required | Meaning |
| --- | --- | --- |
| `keywords` | yes | Non-empty list of case-insensitive substrings, matched against the delegation label and prompt text. |
| `route.provider`, `route.model` | yes | The child's provider and model. Must already be an allowed route in your DSH setup; the plugin cannot grant access. |
| `route.reasoningEffort` | no | Set on the child. When omitted, a caller-supplied effort is dropped so it does not carry onto a different model. |
| `name` | no | Label used in the decision record. |
| `overrideExplicit` | no | Default `false`: a rule never replaces a route the caller set explicitly (`provider`, `model` or `reasoningEffort` in `agentOptions`). Set `true` to let this rule win anyway. |

A malformed rule fails the plugin at load time with the offending path (for
example `rules.0.match: unknown rule key`), so a typo cannot silently route or
silently pass everything through.

## Behaviour

- **First match wins**, in config order. Matching is a lowercase substring test on
  `label + "\n" + prompt text`; an empty keyword never matches.
- **Explicit routes are preserved.** If the delegating agent asked for a
  provider/model itself, rules without `overrideExplicit` leave it alone.
- **No fallback route.** A delegation no rule matches passes through untouched, so
  DSH's own inheritance applies.
- **Non-route options survive.** `cwd`, token limits and other `agentOptions` are
  kept; only `provider`, `model` and `reasoningEffort` are rewritten.
- **Providers that cannot take `agentOptions` are left alone.** Out-of-process
  backends (for example ACP) declare `capabilities.agentOptions: false`; routing
  them would fail the delegation, so they pass through untouched.
- **Pure decisions.** `decide(rules, { label, promptText, requested })` is exported
  and returns `{ action, reason, rule, matchedKeyword, agentOptions? }`, so you can
  dry-run a rule set in a script before enabling it. Pass rules through
  `validateConfig(config).rules` first; `decide` assumes the validated shape.

## Limitations

- Routes are applied after the subagent tool's own preflight, so the plugin does
  not re-check a configured route against DSH's model-selection allowlist. Only
  configure routes your profile already permits. `reasoningEffort` is likewise
  passed on as written; an unknown effort id is rejected by DSH, not at load.
- Routing happens when a child is created. A running child's model is never
  changed, and failures (quota, auth, rate limits) are not rerouted; pair with a
  fallback plugin if you need that.
- Keyword matching is deliberately simple. If you need classification, write the
  classifier and feed its result in as a label.

## Development

```sh
npm test
```

The unit tests need Node 22.18+ (TypeScript test files run via type stripping).
Two tests load the plugin through DSH's real Cordis loader; they find a global DSH
install automatically or via `DSH_NODE_MODULES=<dsh>/node_modules`, and are
skipped when none is present. Tested against DSH `0.2.1-rc.5`.

## License

MIT
