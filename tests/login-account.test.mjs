import assert from 'node:assert/strict';
import test from 'node:test';
import { loginAccountSchema } from '../lib/login-account.ts';

test('administrator login normalizes casing and surrounding whitespace', () => {
  for (const input of ['admin', 'ADMIN', 'AdMiN', '  admin  ', '\tADMIN\n']) {
    assert.equal(loginAccountSchema.parse(input), 'admin');
  }
});

test('existing email logins remain supported and normalize consistently', () => {
  for (const [input, expected] of [
    ['admin@tongbanji.local', 'admin@tongbanji.local'],
    ['  Recorder@Example.COM  ', 'recorder@example.com'],
    ['student.one+class@example.test', 'student.one+class@example.test'],
  ]) {
    assert.equal(loginAccountSchema.parse(input), expected);
  }
});

test('blank input, arbitrary usernames and malformed emails cannot become accounts', () => {
  for (const input of ['', '  \t\n ', 'administrator', 'teacher', 'admin1', 'ad min',
    'admin@example', '@example.com', 'admin@', 'admin @example.com', 'ａｄｍｉｎ']) {
    assert.equal(loginAccountSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test('the normalized account is limited to 160 characters', () => {
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(31)}`;
  assert.equal(email.length, 160);
  assert.equal(loginAccountSchema.parse(` ${email} `), email);
  assert.equal(loginAccountSchema.safeParse(`${email}c`).success, false);
  assert.equal(loginAccountSchema.safeParse('admin'.repeat(33)).success, false);
});

test('non-string values are rejected without coercion', () => {
  for (const input of [undefined, null, 123, true, ['admin'], { email: 'admin' }, {}]) {
    assert.equal(loginAccountSchema.safeParse(input).success, false);
  }
});
