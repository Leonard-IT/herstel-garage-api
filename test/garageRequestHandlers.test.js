'use strict';

// Tests the HTTP handlers of GET garage/repair-requests and GET garage/repair-requests/{id} with the Azure runtime, authentication,
// storage and database replaced by stubs: what the garage is passed on to the queries, and what comes back.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const functionsDir = path.join(__dirname, '..', 'src', 'functions');
const GARAGE_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

const stubs = { auth: null, list: null, get: null };
const handlers = {};

function stubModule(resolved, exports) {
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule(require.resolve('@azure/functions', { paths: [functionsDir] }), {
  app: { http: (name, options) => { handlers[name] = options; } },
});
stubModule(require.resolve('../src/lib/garageAuth'), { requireGarage: (...args) => stubs.auth(...args) });
stubModule(require.resolve('../src/lib/garageRequestRepository'), {
  listOpenRequests: (...args) => stubs.list(...args),
  getOpenRequest: (...args) => stubs.get(...args),
});
stubModule(require.resolve('../src/lib/blobStorage'), {
  createReadUrls: async (paths) => new Map(paths.map((p) => [p, `https://storage.test/${p}?sig=x`])),
});
require('../src/functions/listGarageRepairRequests');
require('../src/functions/getGarageRepairRequest');

const context = { log: () => {}, warn: () => {}, error: () => {} };
const callList = () => handlers.listGarageRepairRequests.handler({ headers: new Headers() }, context);
const callGet = (id = REQUEST_ID) => handlers.getGarageRepairRequest.handler({ params: { id }, headers: new Headers() }, context);

const myOffer = {
  id: '44444444-4444-4444-4444-444444444444',
  availableFrom: '2026-10-12',
  validityHours: 24,
  expiresAt: '2026-10-10T12:00:00.000Z',
  createdAt: '2026-10-09T12:00:00.000Z',
};
const base = (overrides = {}) => ({
  id: REQUEST_ID,
  damageReportId: '99999999-9999-9999-9999-999999999999',
  createdAt: '2026-10-08T10:00:00.000Z',
  car: { make: 'Volkswagen', model: 'Golf', buildYear: 2018 },
  description: 'Deuk',
  damageType: 'carrosserie',
  location: 'left',
  postalArea: '3511',
  status: 'open',
  myOffer: null,
  preferences: [],
  ...overrides,
});

test.beforeEach(() => {
  stubs.auth = async () => ({ garageId: GARAGE_ID, userId: 'u1' });
  stubs.list = async () => [];
  stubs.get = async () => null;
});

test('the list is asked for the garage of the caller', async () => {
  let askedFor;
  stubs.list = async (garageId) => { askedFor = garageId; return []; };

  const response = await callList();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(askedFor, GARAGE_ID);
});

test('the list shows each request with its status and, for the own garage only, the own offer', async () => {
  stubs.list = async () => [
    { ...base({ id: 'a' }), thumbnailPaths: ['a/1.jpg', 'a/2.jpg'], imageCount: 2 },
    { ...base({ id: 'b', status: 'in_option', myOffer }), thumbnailPaths: ['b/1.jpg'], imageCount: 1 },
    { ...base({ id: 'c', status: 'in_option', myOffer: null }), thumbnailPaths: [], imageCount: 0 },
  ];

  const { jsonBody } = await callList();
  const [a, b, c] = jsonBody.repairRequests;

  assert.deepStrictEqual([a.status, b.status, c.status], ['open', 'in_option', 'in_option']);
  assert.strictEqual(a.myOffer, null);
  assert.deepStrictEqual(b.myOffer, myOffer);
  assert.strictEqual(c.myOffer, null); // in option with another garage: only the status is visible
  assert.deepStrictEqual(a.thumbnailUrls, ['https://storage.test/a/1.jpg?sig=x', 'https://storage.test/a/2.jpg?sig=x']);
  assert.strictEqual(c.thumbnailUrl, null);
});

test('the list does not expose internal fields', async () => {
  stubs.list = async () => [{ ...base(), thumbnailPaths: ['a/1.jpg'], imageCount: 1 }];

  const { jsonBody } = await callList();

  assert.strictEqual('damageReportId' in jsonBody.repairRequests[0], false);
  assert.strictEqual('thumbnailPaths' in jsonBody.repairRequests[0], false);
});

test('the detail is asked for the request and the garage of the caller, and shows status and own offer', async () => {
  let asked;
  stubs.get = async (id, garageId) => { asked = { id, garageId }; return { ...base({ status: 'in_option', myOffer }), imagePaths: ['a/1.jpg'] }; };

  const { status, jsonBody } = await callGet();

  assert.strictEqual(status, 200);
  assert.deepStrictEqual(asked, { id: REQUEST_ID, garageId: GARAGE_ID });
  assert.strictEqual(jsonBody.status, 'in_option');
  assert.deepStrictEqual(jsonBody.myOffer, myOffer);
  assert.deepStrictEqual(jsonBody.images, [{ url: 'https://storage.test/a/1.jpg?sig=x' }]);
  assert.strictEqual('damageReportId' in jsonBody, false);
  assert.strictEqual('imagePaths' in jsonBody, false);
});

test('the detail answers 404 for an unknown or closed request and for an id that is not a GUID', async () => {
  assert.strictEqual((await callGet()).status, 404); // repository returns null
  stubs.get = async () => assert.fail('must not be called');
  assert.strictEqual((await callGet('not-a-guid')).status, 404);
});
