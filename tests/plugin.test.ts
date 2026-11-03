import assert from 'node:assert/strict';
import test from 'node:test';

import { apply } from '../src/index.js';

interface ActivationSpec {
  label: string;
  request: {
    prompt: unknown;
    agentOptions?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

function createContext() {
  const calls: ActivationSpec[] = [];
  const original = async (spec: ActivationSpec) => {
    calls.push(spec);
    return 'activation-result';
  };
  let disposeEffect: (() => void) | undefined;
  const ctx = {
    subagents: { startActivation: original },
    effect(execute: () => () => void) {
      disposeEffect = execute();
      return disposeEffect;
    },
  };
  return { ctx, calls, original, dispose: () => disposeEffect?.() };
}

const rules = [
  {
    name: 'research',
    keywords: ['investigate'],
    route: { provider: 'anthropic', model: 'claude-sonnet-4', reasoningEffort: 'high' },
  },
];

test('rejects a malformed rule before wrapping activation', () => {
  const { ctx, original } = createContext();
  assert.throws(
    () => apply(ctx, { rules: [{ match: 'smoke', provider: 'p', model: 'm' }] }),
    /rules\.0\.match/,
  );
  assert.equal(ctx.subagents.startActivation, original);
});

test('passes an unmatched delegation through unchanged', async () => {
  const { ctx, calls } = createContext();
  apply(ctx, { rules });
  const spec: ActivationSpec = {
    label: 'implement',
    request: { prompt: [{ type: 'text', text: 'Fix the failing test' }] },
  };

  await ctx.subagents.startActivation(spec);
  assert.equal(calls[0], spec);
});

test('restores the original activation on disposal', () => {
  const { ctx, original, dispose } = createContext();
  apply(ctx, { rules });
  assert.notEqual(ctx.subagents.startActivation, original);

  dispose();
  assert.equal(ctx.subagents.startActivation, original);
});

test('disposal leaves a wrapper that someone else installed on top of ours', () => {
  const { ctx, original, dispose } = createContext();
  apply(ctx, { rules });
  const ours = ctx.subagents.startActivation;
  const theirs = async (spec: ActivationSpec) => ours(spec);
  ctx.subagents.startActivation = theirs;

  dispose();
  assert.equal(ctx.subagents.startActivation, theirs);
  assert.notEqual(ctx.subagents.startActivation, original);
});

test('wraps and restores a prototype method like the real SubagentRuntime', async () => {
  const calls: ActivationSpec[] = [];
  class Runtime {
    async startActivation(spec: ActivationSpec) {
      calls.push(spec);
      return 'activation-result';
    }
  }
  const service = new Runtime();
  const protoMethod = Runtime.prototype.startActivation;
  let disposeEffect: (() => void) | undefined;
  const ctx = {
    subagents: service,
    effect(execute: () => () => void) {
      disposeEffect = execute();
      return disposeEffect;
    },
  };
  apply(ctx, { rules });
  await service.startActivation({
    label: 'x',
    request: { prompt: 'please investigate' },
  });
  assert.equal(calls[0].request.agentOptions?.model, 'claude-sonnet-4');

  disposeEffect?.();
  assert.equal(service.startActivation, protoMethod);
});

test('passes through when the provider rejects agentOptions', async () => {
  const { ctx, calls } = createContext();
  const providers: Record<string, { capabilities: { agentOptions: boolean } }> = {
    acp: { capabilities: { agentOptions: false } },
    spawn: { capabilities: { agentOptions: true } },
  };
  (ctx.subagents as Record<string, unknown>).getProvider = (name: string) => providers[name];
  apply(ctx, { rules });
  const prompt = [{ type: 'text', text: 'Investigate this' }];

  const external: ActivationSpec = { label: 'a', provider: 'acp', request: { prompt } };
  await ctx.subagents.startActivation(external);
  assert.equal(calls[0], external);

  await ctx.subagents.startActivation({ label: 'b', provider: 'spawn', request: { prompt } });
  assert.equal(calls[1].request.agentOptions?.model, 'claude-sonnet-4');

  await ctx.subagents.startActivation({ label: 'c', provider: 'unknown', request: { prompt } });
  assert.equal(calls[2].request.agentOptions?.model, 'claude-sonnet-4');
});

test('routes a matched delegation through the original activation', async () => {
  const { ctx, calls } = createContext();
  apply(ctx, { rules });
  const spec: ActivationSpec = {
    label: 'library-check',
    provider: 'dsh',
    request: {
      prompt: [{ type: 'text', text: 'Investigate current API behavior' }],
      agentOptions: { maxTokens: 2048 },
    },
  };
  const originalSpec = structuredClone(spec);

  assert.equal(await ctx.subagents.startActivation(spec), 'activation-result');
  assert.deepEqual(spec, originalSpec);
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0], spec);
  assert.deepEqual(calls[0].request.agentOptions, {
    maxTokens: 2048,
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    reasoningEffort: 'high',
  });
});
