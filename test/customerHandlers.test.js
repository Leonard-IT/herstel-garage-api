'use strict';

// Tests the HTTP handlers of the customer page with the Azure runtime, database and storage replaced by stubs.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.CUSTOMER_SITE_URL = 'https://site.test/';

const functionsDir = path.join(__dirname, '..', 'src', 'functions');
const TOKEN = 'C'.repeat(43);
const OFFER = '33333333-3333-3333-3333-333333333333';
const REQUEST = '44444444-4444-4444-4444-444444444444';

const stubs = {};
const handlers = {};
const routes = {};
function stubModule(resolved, exports) {
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const lazy = (name) => (...args) => stubs[name](...args);

stubModule(require.resolve('@azure/functions', { paths: [functionsDir] }), {
  app: { http: (name, options) => { handlers[name] = options.handler; routes[name] = options.route; } },
});
stubModule(require.resolve('../src/lib/customerRequestRepository'), {
  getCustomerRequest: lazy('getCustomerRequest'),
  respondToOffer: lazy('respondToOffer'),
  ensureCustomerToken: lazy('ensureCustomerToken'),
});
stubModule(require.resolve('../src/lib/blobStorage'), { createReadUrls: async (paths) => new Map(paths.map((p) => [p, `https://storage.test/${p}`])) });
stubModule(require.resolve('../src/lib/adminAuth'), { requireAdmin: lazy('requireAdmin') });
for (const file of ['getCustomerRepairRequest', 'respondToCustomerOffer', 'createCustomerLink']) require(`../src/functions/${file}`);

const context = { log: () => {}, warn: () => {}, error: () => {} };
const call = (name, params) => handlers[name]({ params, headers: new Map() }, context);

const record = () => ({
  id: REQUEST,
  status: 'open',
  createdAt: new Date('2026-10-08T09:00:00Z'),
  postalCode: '3511AB',
  firstName: 'Piet',
  carDrivable: 'yes',
  carLocation: 'home',
  car: { licensePlate: 'AB123C', make: 'Volkswagen', model: 'Golf', buildYear: 2018 },
  damage: { description: 'Deuk', damageType: 'carrosserie', location: 'left' },
  imagePaths: ['damage-reports/x/1.jpg'],
  preferences: [],
  offers: [],
});

test.beforeEach(() => {
  stubs.getCustomerRequest = async () => record();
  stubs.respondToOffer = async () => ({ ok: true });
  stubs.ensureCustomerToken = async () => TOKEN;
  stubs.requireAdmin = () => ({ adminId: 'admin-1' });
});

test('routes: the customer endpoints and the backoffice link', () => {
  assert.strictEqual(routes.getCustomerRepairRequest, 'customer/repair-requests/{token}');
  assert.strictEqual(routes.acceptCustomerOffer, 'customer/repair-requests/{token}/offers/{offerId}/accept');
  assert.strictEqual(routes.declineCustomerOffer, 'customer/repair-requests/{token}/offers/{offerId}/decline');
  assert.strictEqual(routes.createCustomerLink, 'backoffice/repair-requests/{id}/customer-link');
});

test('GET: the view of the request, never cached', async () => {
  const res = await call('getCustomerRepairRequest', { token: TOKEN });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
  assert.strictEqual(res.jsonBody.request.stage, 'waiting_for_offer');
  assert.deepStrictEqual(res.jsonBody.request.images, [{ url: 'https://storage.test/damage-reports/x/1.jpg' }]);
  assert.ok(res.jsonBody.nextSteps.title);
});

test('GET: a malformed token is a 404 without asking the database; an unknown token too', async () => {
  let asked = false;
  stubs.getCustomerRequest = async () => { asked = true; return null; };
  assert.strictEqual((await call('getCustomerRepairRequest', { token: 'short' })).status, 404);
  assert.strictEqual(asked, false);
  assert.strictEqual((await call('getCustomerRepairRequest', { token: TOKEN })).status, 404);
  assert.strictEqual(asked, true);
});

test('accept: passes token, offer and action on, and answers with the new view', async () => {
  let given;
  stubs.respondToOffer = async (args) => { given = args; return { ok: true }; };
  const res = await call('acceptCustomerOffer', { token: TOKEN, offerId: OFFER.toUpperCase() });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(given, { token: TOKEN, offerId: OFFER, action: 'accept' });
  assert.ok(res.jsonBody.request);
});

test('decline uses the decline action', async () => {
  let given;
  stubs.respondToOffer = async (args) => { given = args; return { ok: true }; };
  assert.strictEqual((await call('declineCustomerOffer', { token: TOKEN, offerId: OFFER })).status, 200);
  assert.strictEqual(given.action, 'decline');
});

test('answer errors map to 404 and 409 with their code', async () => {
  for (const [error, status] of [['not_found', 404], ['request_closed', 409], ['offer_expired', 409], ['offer_closed', 409]]) {
    stubs.respondToOffer = async () => ({ error });
    const res = await call('acceptCustomerOffer', { token: TOKEN, offerId: OFFER });
    assert.strictEqual(res.status, status, error);
    assert.strictEqual(res.jsonBody.error, error);
  }
  assert.strictEqual((await call('acceptCustomerOffer', { token: TOKEN, offerId: 'not-a-guid' })).status, 404);
});

test('a database failure is a 500 with a general message', async () => {
  stubs.respondToOffer = async () => { throw new Error('boom'); };
  const res = await call('acceptCustomerOffer', { token: TOKEN, offerId: OFFER });
  assert.strictEqual(res.status, 500);
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /boom/);
});

test('backoffice: the customer link for a request, for administrators only', async () => {
  const res = await call('createCustomerLink', { id: REQUEST });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.jsonBody.customerUrl, `https://site.test/mijn-aanvraag.html#${TOKEN}`);

  stubs.ensureCustomerToken = async () => null;
  assert.strictEqual((await call('createCustomerLink', { id: REQUEST })).status, 404);

  stubs.requireAdmin = () => ({ response: { status: 403 } });
  assert.strictEqual((await call('createCustomerLink', { id: REQUEST })).status, 403);
});
