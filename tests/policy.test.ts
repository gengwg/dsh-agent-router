import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, extractPromptText, hasExplicitRoute } from '../src/policy.js';

interface RouteRule {
  name?: string;
  keywords: string[];
  route: { provider: string; model: string; reasoningEffort?: string };
  overrideExplicit?: boolean;
}

const reasoningRule: RouteRule = {
  name: 'reasoning',
  keywords: ['review', 'analy'],
  route: { provider: 'reasoning-prov', model: 'reasoning-model', reasoningEffort: 'high' },
};
const routineRule: RouteRule = {
  name: 'routine',
  keywords: ['typo', 'rename'],
  route: { provider: 'routine-prov', model: 'routine-model' },
};
const rules = [reasoningRule, routineRule];

test('no rules: passthrough with no-rules reason', () => {
  const d = decide([], { promptText: 'review this' });
  assert.equal(d.action, 'passthrough');
  assert.equal(d.reason, 'no-rules');
  assert.equal(d.agentOptions, undefined);
});

test('a missing promptText never matches the literal "undefined"', () => {
  const d = decide([{ keywords: ['fine'], route: { provider: 'p', model: 'm' } }], { label: 'x' });
  assert.equal(d.action, 'passthrough');
  assert.equal(d.reason, 'no-matching-rule');
});

test('matching rule routes by replacing provider/model on agentOptions', () => {
  const d = decide(rules, { promptText: 'Please review this diff' });
  assert.equal(d.action, 'route');
  assert.equal(d.reason, 'matched-rule');
  assert.equal(d.rule, 'reasoning');
  assert.equal(d.matchedKeyword, 'review');
  assert.deepEqual(d.agentOptions, {
    provider: 'reasoning-prov',
    model: 'reasoning-model',
    reasoningEffort: 'high',
  });
});

test('matching is case-insensitive and covers the delegation label', () => {
  const d = decide(rules, { label: 'REVIEW auth flow', promptText: 'look at this' });
  assert.equal(d.action, 'route');
  assert.equal(d.rule, 'reasoning');
});

test('first matching rule in config order wins', () => {
  const d = decide(rules, { promptText: 'review then rename the variable' });
  assert.equal(d.rule, 'reasoning');
});

test('no matching rule: passthrough, no agentOptions emitted', () => {
  const d = decide(rules, { promptText: 'unrelated work', requested: { cwd: '/tmp' } });
  assert.equal(d.action, 'passthrough');
  assert.equal(d.reason, 'no-matching-rule');
  assert.equal(d.rule, null);
  assert.equal(d.agentOptions, undefined);
});

test('explicit caller route is preserved even when a rule matches', () => {
  const d = decide(rules, {
    promptText: 'review this',
    requested: { provider: 'caller-prov', model: 'caller-model' },
  });
  assert.equal(d.action, 'passthrough');
  assert.equal(d.reason, 'explicit-route-preserved');
  assert.equal(d.rule, 'reasoning');
  assert.equal(d.agentOptions, undefined);
});

test('reasoningEffort alone counts as an explicit route', () => {
  assert.equal(hasExplicitRoute({ reasoningEffort: 'low' }), true);
  const d = decide(rules, { promptText: 'review', requested: { reasoningEffort: 'low' } });
  assert.equal(d.reason, 'explicit-route-preserved');
});

test('non-route agentOptions (cwd) do not count as explicit and survive routing', () => {
  const d = decide(rules, { promptText: 'rename x', requested: { cwd: '/work' } });
  assert.equal(d.action, 'route');
  assert.equal(d.rule, 'routine');
  assert.deepEqual(d.agentOptions, {
    cwd: '/work',
    provider: 'routine-prov',
    model: 'routine-model',
  });
});

test('route without reasoningEffort clears inherited reasoningEffort', () => {
  const d = decide(
    [{ ...routineRule, overrideExplicit: true }],
    { promptText: 'rename x', requested: { reasoningEffort: 'max', model: 'old' } },
  );
  assert.equal(d.action, 'route');
  assert.deepEqual(d.agentOptions, { provider: 'routine-prov', model: 'routine-model' });
  assert.equal('reasoningEffort' in (d.agentOptions ?? {}), false);
});

test('overrideExplicit lets a rule replace an explicit caller route', () => {
  const d = decide(
    [{ ...reasoningRule, overrideExplicit: true }],
    { promptText: 'review', requested: { provider: 'caller-prov', model: 'caller-model' } },
  );
  assert.equal(d.action, 'route');
  assert.equal(d.agentOptions?.provider, 'reasoning-prov');
  assert.equal(d.agentOptions?.model, 'reasoning-model');
});

test('empty keyword never matches everything', () => {
  const d = decide(
    [{ name: 'bad', keywords: [''], route: routineRule.route }],
    { promptText: 'anything' },
  );
  assert.equal(d.action, 'passthrough');
});

test('decide does not mutate the caller agentOptions object', () => {
  const requested = { cwd: '/work' };
  decide(rules, { promptText: 'rename x', requested });
  assert.deepEqual(requested, { cwd: '/work' });
});

test('extractPromptText handles strings, content blocks, and other shapes', () => {
  assert.equal(extractPromptText('hello'), 'hello');
  assert.equal(
    extractPromptText([{ type: 'text', text: 'a' }, { type: 'image' }, { text: 'b' }]),
    'a\n\nb',
  );
  assert.equal(extractPromptText(undefined), '');
  assert.equal(extractPromptText(42), '');
});

test('hasExplicitRoute is false for missing or empty agentOptions', () => {
  assert.equal(hasExplicitRoute(undefined), false);
  assert.equal(hasExplicitRoute({}), false);
  assert.equal(hasExplicitRoute({ cwd: '/x' }), false);
});
