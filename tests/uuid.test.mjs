import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { createUuid } from '../lib/uuid.ts';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uses native randomUUID when available and preserves its receiver', () => {
  const source = {
    randomUUID() {
      assert.equal(this, source);
      return '01234567-89ab-4cde-8fab-0123456789ab';
    },
    getRandomValues() { throw new Error('Fallback should not run.'); },
  };
  assert.equal(createUuid(source), '01234567-89ab-4cde-8fab-0123456789ab');
});

test('fallback sets UUID v4 and variant bits without discarding the other random bits', () => {
  const source = { getRandomValues(bytes) { bytes.fill(0xff); return bytes; } };
  assert.equal(createUuid(source), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(createUuid({ getRandomValues(bytes) { bytes.fill(0); return bytes; } }), '00000000-0000-4000-8000-000000000000');
});

test('works with secure random values when randomUUID is unavailable', () => {
  const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const values = new Set(Array.from({ length: 100 }, () => createUuid(source)));
  assert.equal(values.size, 100);
  for (const value of values) assert.match(value, uuidV4);
});

test('reports unavailable secure randomness instead of using a weak random source', () => {
  assert.throws(() => createUuid({}), /无法生成安全登记编号/);
  assert.throws(() => createUuid(null), /无法生成安全登记编号/);
});
