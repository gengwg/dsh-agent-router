import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config, validateConfig } from '../src/config.js';

const goodRule = {
  name: 'research',
  keywords: ['investigate'],
  route: { provider: 'openrouter', model: 'some/model', reasoningEffort: 'high' },
};

test('Config is a Standard Schema v1 object', () => {
  assert.equal(Config['~standard'].version, 1);
  assert.equal(typeof Config['~standard'].validate, 'function');
});

test('an absent config validates to an empty rule list', () => {
  assert.deepEqual(validateConfig(undefined), { rules: [] });
  assert.deepEqual(validateConfig({}), { rules: [] });
});

test('a canonical rule validates and keeps optional fields', () => {
  const value = validateConfig({ rules: [{ ...goodRule, overrideExplicit: true }] });
  assert.deepEqual(value, { rules: [{ ...goodRule, overrideExplicit: true }] });
});

test('the flat match/provider/model shape is rejected with a path', () => {
  const result = Config['~standard'].validate({
    rules: [{ match: 'smoke', provider: 'openrouter', model: 'some/model' }],
  });
  assert.ok('issues' in result && result.issues.length > 0);
  const paths = result.issues.map((issue) => issue.path?.join('.'));
  assert.ok(paths.includes('rules.0.match'), `unexpected paths: ${paths.join(', ')}`);
  assert.ok(paths.includes('rules.0.keywords'), `unexpected paths: ${paths.join(', ')}`);
  assert.ok(paths.includes('rules.0.route'), `unexpected paths: ${paths.join(', ')}`);
});

test('keywords must be a non-empty list of non-empty strings', () => {
  for (const keywords of [undefined, [], [''], ['ok', 3], 'review']) {
    const result = Config['~standard'].validate({
      rules: [{ keywords, route: { provider: 'p', model: 'm' } }],
    });
    assert.ok('issues' in result, `accepted keywords=${JSON.stringify(keywords)}`);
  }
});

test('route needs provider and model strings', () => {
  for (const route of [undefined, {}, { provider: 'p' }, { model: 'm' }, { provider: 'p', model: 1 }]) {
    const result = Config['~standard'].validate({ rules: [{ keywords: ['k'], route }] });
    assert.ok('issues' in result, `accepted route=${JSON.stringify(route)}`);
  }
});

test('validateConfig throws a readable error naming the bad field', () => {
  assert.throws(
    () => validateConfig({ rules: [{ match: 'x', provider: 'p', model: 'm' }] }),
    /rules\.0\.match/,
  );
});
