'use strict';

// Tests garage prospects, signing up through an invitation and the onboarding funnel, with the Azure runtime, administrator check and
// database replaced by stubs. The pure parts (validation, the shape of an invite) are tested directly.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const functionsDir = path.join(__dirname, '..', 'src', 'functions');
const TOKEN = 'T'.repeat(43);

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
stubModule(require.resolve('../src/lib/adminAuth'), { requireAdmin: lazy('requireAdmin') });
stubModule(require.resolve('../src/lib/prospectRepository'), { listProspects: lazy('listProspects'), createProspect: lazy('createProspect') });
stubModule(require.resolve('../src/lib/garageRepository'), { createGarage: lazy('createGarage') });
stubModule(require.resolve('../src/lib/onboardingRepository'), { listInvites: lazy('listInvites') });
for (const file of ['prospects', 'registerGarage', 'getOnboarding']) require(`../src/functions/${file}`);

const { validateProspect } = require('../src/lib/prospectValidation');
const { toInvite } = requireReal('../src/lib/onboardingRepository');

/** The real module, past the stub above (the stub only stands in for the handlers). */
function requireReal(modulePath) {
  const resolved = require.resolve(modulePath);
  const stub = require.cache[resolved];
  delete require.cache[resolved];
  const real = require(modulePath);
  require.cache[resolved] = stub;
  return real;
}

const context = { log: () => {}, warn: () => {}, error: () => {} };
const call = (name, { body, json } = {}) =>
  handlers[name]({ headers: new Headers(), json: async () => (json ? JSON.parse(json) : body) }, context);

const validRegistration = () => ({
  companyName: 'Autoschade Van Dijk',
  kvkNumber: '12345678',
  street: 'Kanaalweg 12',
  postalCode: '3526 KL',
  city: 'Utrecht',
  contact: { firstName: 'Jan', lastName: 'van Dijk', email: 'jan@vandijk.test', phone: '030 123 45 67' },
  serviceArea: 'Utrecht en omgeving',
  hasLiabilityInsurance: true,
  iban: 'NL91ABNA0417164300',
  acceptedTerms: true,
});

test.beforeEach(() => {
  stubs.requireAdmin = () => ({ adminId: 'admin-1' });
  stubs.listProspects = async () => [];
  stubs.createProspect = async (value) => ({ id: 'p1', ...value, status: 'new' });
  stubs.createGarage = async () => ({ id: 'g1', status: 'pending', registeredAt: 'r', invited: false });
  stubs.listInvites = async () => [];
});

test('the administrator endpoints for prospects and onboarding live under backoffice/', () => {
  for (const name of ['listProspects', 'createProspect', 'getOnboarding']) assert.match(routes[name], /^backoffice\//, name);
});

test('prospects, onboarding: only for administrators, without touching the database', async () => {
  stubs.requireAdmin = () => ({ response: { status: 403 } });
  stubs.listProspects = stubs.createProspect = stubs.listInvites = async () => assert.fail('touched the database');
  for (const name of ['listProspects', 'createProspect', 'getOnboarding']) {
    assert.strictEqual((await call(name, { body: { companyName: 'x', city: 'y' } })).status, 403, name);
  }
});

// ---------- prospects ----------

test('a prospect needs only a name and a place; the rest is checked when it is given', () => {
  const { value } = validateProspect({ companyName: ' Garage Jansen ', city: 'Houten', website: 'www.jansen.nl', postalCode: '3991 ab' });
  assert.strictEqual(value.companyName, 'Garage Jansen');
  assert.strictEqual(value.website, 'https://www.jansen.nl');
  assert.strictEqual(value.postalCode, '3991AB');
  assert.strictEqual(value.phone, null);

  const { errors } = validateProspect({ companyName: '', city: '', phone: '12', email: 'nope', kvkNumber: '123', website: 'not a site', postalCode: 'x' });
  assert.deepStrictEqual(Object.keys(errors).sort(), ['city', 'companyName', 'email', 'kvkNumber', 'phone', 'postalCode', 'website']);
});

test('adding a prospect: 201 with the prospect, 422 for invalid input, 409 for a KvK number that is taken', async () => {
  let received;
  stubs.createProspect = async (value, createdBy) => { received = { value, createdBy }; return { id: 'p1', ...value, status: 'new' }; };
  const created = await call('createProspect', { body: { companyName: 'Garage Jansen', city: 'Houten' } });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(received.createdBy, 'admin-1');

  assert.strictEqual((await call('createProspect', { body: { city: 'Houten' } })).status, 422);
  assert.strictEqual((await call('createProspect', { json: '{nope' })).status, 400);

  stubs.createProspect = async () => { throw Object.assign(new Error('dup'), { statusCode: 409 }); };
  const taken = await call('createProspect', { body: { companyName: 'Garage Jansen', city: 'Houten', kvkNumber: '12345678' } });
  assert.strictEqual(taken.status, 409);
  assert.strictEqual(taken.jsonBody.error, 'already_exists');
});

test('the list of prospects', async () => {
  stubs.listProspects = async () => [{ id: 'p1', companyName: 'Garage Jansen' }];
  const response = await call('listProspects');
  assert.deepStrictEqual(response.jsonBody, { prospects: [{ id: 'p1', companyName: 'Garage Jansen' }] });
});

// ---------- signing up through an invitation ----------

test('signing up passes the invitation token on, and only a well-formed one', async () => {
  const given = [];
  stubs.createGarage = async (value, options) => { given.push(options); return { id: 'g1', status: 'approved', registeredAt: 'r', invited: true }; };

  const invited = await call('registerGarage', { body: { ...validRegistration(), invitationToken: TOKEN } });
  assert.strictEqual(invited.status, 201);
  assert.strictEqual(invited.jsonBody.status, 'approved');
  assert.deepStrictEqual(given[0], { invitationToken: TOKEN });

  await call('registerGarage', { body: { ...validRegistration(), invitationToken: 'not-a-token' } });
  await call('registerGarage', { body: validRegistration() });
  assert.deepStrictEqual(given.slice(1), [{ invitationToken: null }, { invitationToken: null }]);
});

// ---------- the onboarding funnel ----------

test('an invite has the shape the dashboard works with, one timestamp per step', () => {
  const at = (iso) => new Date(iso);
  const invite = toInvite({
    Id: 'l1', ProspectId: 'p1', CompanyName: 'Garage Jansen', City: 'Houten', Make: 'Kia', Model: 'Ceed', DamageType: 'bumper',
    CreatedAt: at('2026-10-06T09:00:00Z'), FirstOpenedAt: at('2026-10-06T10:00:00Z'), FirstClickedAt: null,
    RegisteredAt: null, FirstViewedAt: null, FirstOfferAt: null,
  });
  assert.deepStrictEqual(invite, {
    id: 'l1',
    garageId: 'p1',
    garageName: 'Garage Jansen',
    city: 'Houten',
    repairRequestTitle: 'Kia Ceed · bumper- en kunststofschade',
    events: {
      linkShared: '2026-10-06T09:00:00.000Z',
      linkOpened: '2026-10-06T10:00:00.000Z',
      viewRequestClicked: null,
      registered: null,
      requestViewed: null,
      offerCreated: null,
    },
  });
});

test('the onboarding endpoint answers with the invites', async () => {
  stubs.listInvites = async () => [{ id: 'l1' }];
  assert.deepStrictEqual((await call('getOnboarding')).jsonBody, { invites: [{ id: 'l1' }] });
});
