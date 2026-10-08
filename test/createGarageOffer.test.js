'use strict';

// Tests the HTTP handler of POST /api/garage/repair-requests/{id}/offers with the Azure runtime, authentication and database
// replaced by stubs, so every status code of the endpoint is covered without a database.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { todayInNetherlands } = require('../src/lib/offerValidation');

const functionsDir = path.join(__dirname, '..', 'src', 'functions');
const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const GARAGE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const tomorrow = todayInNetherlands(new Date(Date.now() + 24 * 60 * 60 * 1000));

const stubs = { auth: null, createOffer: null };

function stubModule(resolved, exports) {
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// Load the handler with stubbed dependencies and capture what the function registers with the Azure runtime.
let registered;
stubModule(require.resolve('@azure/functions', { paths: [functionsDir] }), {
  app: { http: (name, options) => { registered = { name, ...options }; } },
});
stubModule(require.resolve('../src/lib/garageAuth'), { requireGarage: (...args) => stubs.auth(...args) });
stubModule(require.resolve('../src/lib/offerRepository'), { createOffer: (...args) => stubs.createOffer(...args) });
require('../src/functions/createGarageOffer');

const logged = [];
const context = { log: () => {}, warn: () => {}, error: (...args) => logged.push(args) };

const call = ({ id = REQUEST_ID, body = { availableFrom: tomorrow, validityHours: 24 }, rawBody } = {}) =>
  registered.handler(
    {
      params: { id },
      headers: new Headers(),
      json: async () => {
        if (rawBody !== undefined) return JSON.parse(rawBody);
        return body;
      },
    },
    context,
  );

const signedIn = () => ({ garageId: GARAGE_ID, userId: USER_ID });
const offer = () => ({
  id: '44444444-4444-4444-4444-444444444444',
  repairRequestId: REQUEST_ID,
  availableFrom: tomorrow,
  validityHours: 24,
  expiresAt: '2026-10-10T12:00:00.000Z',
  status: 'active',
  createdAt: '2026-10-09T12:00:00.000Z',
});

test.beforeEach(() => {
  logged.length = 0;
  stubs.auth = async () => signedIn();
  stubs.createOffer = async () => offer();
});

test('is registered as POST garage/repair-requests/{id}/offers', () => {
  assert.strictEqual(registered.name, 'createGarageOffer');
  assert.deepStrictEqual(registered.methods, ['POST']);
  assert.strictEqual(registered.route, 'garage/repair-requests/{id}/offers');
});

test('creates the offer for the signed-in garage and user and answers 201', async () => {
  let received;
  stubs.createOffer = async (args) => { received = args; return offer(); };

  const response = await call();

  assert.strictEqual(response.status, 201);
  assert.deepStrictEqual(response.jsonBody, offer());
  assert.deepStrictEqual(received, {
    repairRequestId: REQUEST_ID,
    garageId: GARAGE_ID,
    userId: USER_ID,
    availableFrom: tomorrow,
    validityHours: 24,
  });
});

test('ignores a garage or request id in the body: they come from the login and the URL', async () => {
  let received;
  stubs.createOffer = async (args) => { received = args; return offer(); };

  await call({ body: { availableFrom: tomorrow, validityHours: 12, garageId: 'other', repairRequestId: 'other', status: 'accepted' } });

  assert.strictEqual(received.garageId, GARAGE_ID);
  assert.strictEqual(received.repairRequestId, REQUEST_ID);
  assert.strictEqual('status' in received, false);
});

test('passes on the 401 and 403 of the authentication check, without touching the database', async () => {
  for (const status of [401, 403]) {
    stubs.auth = async () => ({ response: { status, jsonBody: { error: 'x' } } });
    stubs.createOffer = async () => assert.fail('must not be called');
    assert.strictEqual((await call()).status, status);
  }
});

test('answers 404 for an id that is not a GUID', async () => {
  stubs.createOffer = async () => assert.fail('must not be called');
  assert.strictEqual((await call({ id: 'not-a-guid' })).status, 404);
  assert.strictEqual((await call({ id: "1; DROP TABLE dbo.Offers" })).status, 404);
});

test('answers 400 for a body that is not JSON', async () => {
  const response = await call({ rawBody: '{nope' });
  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.jsonBody.error, 'invalid_json');
});

test('answers 422 with the invalid fields, without touching the database', async () => {
  stubs.createOffer = async () => assert.fail('must not be called');

  const response = await call({ body: { availableFrom: '2020-01-01', validityHours: 36 } });

  assert.strictEqual(response.status, 422);
  assert.strictEqual(response.jsonBody.error, 'validation_failed');
  assert.deepStrictEqual(Object.keys(response.jsonBody.details).sort(), ['availableFrom', 'validityHours']);
});

test('answers 404 when the request does not exist or is no longer open', async () => {
  stubs.createOffer = async () => null;

  const response = await call();

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.jsonBody.error, 'not_found');
});

test('answers 409 when the garage already has an active offer on this request', async () => {
  stubs.createOffer = async () => { throw Object.assign(new Error('duplicate key'), { statusCode: 409 }); };

  const response = await call();

  assert.strictEqual(response.status, 409);
  assert.strictEqual(response.jsonBody.error, 'already_offered');
});

test('answers 409 in_option, without details, when another garage has an active offer', async () => {
  stubs.createOffer = async () => { throw Object.assign(new Error('Request is in option'), { statusCode: 409, code: 'in_option' }); };

  const response = await call();

  assert.strictEqual(response.status, 409);
  assert.strictEqual(response.jsonBody.error, 'in_option');
  // Which garage and until when stays private.
  assert.deepStrictEqual(Object.keys(response.jsonBody).sort(), ['error', 'message']);
});

test('answers 500 without leaking internals when something unexpected fails', async () => {
  stubs.createOffer = async () => { throw new Error('Login failed for user sa at server secret.database.windows.net'); };

  const response = await call();

  assert.strictEqual(response.status, 500);
  assert.strictEqual(response.jsonBody.error, 'internal_error');
  assert.doesNotMatch(JSON.stringify(response.jsonBody), /secret|Login failed/);
  assert.strictEqual(logged.length, 1); // the real error is logged
});
