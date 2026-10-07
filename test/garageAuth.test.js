'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getCallerId, devAuthAllowed } = require('../src/lib/garageAuth');

const headers = (obj) => new Headers(obj);

test('uses the user id set by App Service Authentication', () => {
  assert.strictEqual(getCallerId(headers({ 'x-ms-client-principal-id': 'abc-123' }), {}), 'abc-123');
});

test('ignores the dev header unless dev auth is enabled', () => {
  assert.strictEqual(getCallerId(headers({ 'x-dev-user-id': 'dev-1' }), {}), null);
  assert.strictEqual(getCallerId(headers({ 'x-dev-user-id': 'dev-1' }), { ALLOW_DEV_AUTH: 'true' }), 'dev-1');
});

test('dev auth is refused inside Azure even when enabled', () => {
  const env = { ALLOW_DEV_AUTH: 'true', WEBSITE_SITE_NAME: 'fn-garage-api-prod' };
  assert.strictEqual(devAuthAllowed(env), false);
  assert.strictEqual(getCallerId(headers({ 'x-dev-user-id': 'dev-1' }), env), null);
});

test('rejects missing or malformed ids', () => {
  assert.strictEqual(getCallerId(headers({}), {}), null);
  assert.strictEqual(getCallerId(headers({ 'x-ms-client-principal-id': "x'; DROP TABLE" }), {}), null);
});

const principal = (claims) => Buffer.from(JSON.stringify({ auth_typ: 'aad', claims })).toString('base64');

test('prefers the oid claim over x-ms-client-principal-id', () => {
  const h = headers({
    'x-ms-client-principal': principal([{ typ: 'sub', val: 'subject-1' }, { typ: 'oid', val: 'ceec409a-06d9-4085-a778-57157c69a882' }]),
    'x-ms-client-principal-id': 'subject-1',
  });
  assert.strictEqual(getCallerId(h, {}), 'ceec409a-06d9-4085-a778-57157c69a882');
});

test('understands the long object id claim name', () => {
  const h = headers({
    'x-ms-client-principal': principal([{ typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'abc-123' }]),
  });
  assert.strictEqual(getCallerId(h, {}), 'abc-123');
});

test('falls back to the principal id header when the claims are missing or unreadable', () => {
  assert.strictEqual(getCallerId(headers({ 'x-ms-client-principal': 'not-base64-json', 'x-ms-client-principal-id': 'fallback-1' }), {}), 'fallback-1');
  assert.strictEqual(getCallerId(headers({ 'x-ms-client-principal': principal([{ typ: 'sub', val: 's' }]), 'x-ms-client-principal-id': 'fallback-2' }), {}), 'fallback-2');
});
