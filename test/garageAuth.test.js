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
