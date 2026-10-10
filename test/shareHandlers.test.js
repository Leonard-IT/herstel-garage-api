'use strict';

// Tests the HTTP handlers of the share link feature with the Azure runtime, administrator check, storage and database replaced by stubs.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.SHARE_BASE_URL = 'https://share.test/api';
process.env.DASHBOARD_URL = 'https://garage.test';

const functionsDir = path.join(__dirname, '..', 'src', 'functions');
const GUID_A = '11111111-1111-1111-1111-111111111111';
const GUID_B = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'T'.repeat(43);
const WHATSAPP = 'WhatsApp/2.23.20.0 A';
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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
stubModule(require.resolve('../src/lib/adminAuth'), { requireAdmin: lazy('requireAdmin'), isAdminId: lazy('isAdminId') });
stubModule(require.resolve('../src/lib/shareLinkRepository'), {
  listApprovedGarages: lazy('listApprovedGarages'),
  createLinks: lazy('createLinks'),
  listLinks: lazy('listLinks'),
  revokeLink: lazy('revokeLink'),
  getPublicView: lazy('getPublicView'),
  recordView: lazy('recordView'),
  recordClick: lazy('recordClick'),
});
stubModule(require.resolve('../src/lib/blobStorage'), { readImage: lazy('readImage') });
stubModule(require.resolve('../src/lib/garageRequestRepository'), { listOpenRequests: lazy('listOpenRequests') });
stubModule(require.resolve('../src/lib/requestListView'), { presentRequestList: async (requests) => ({ repairRequests: requests }) });
for (const file of ['adminMe', 'listAdminRepairRequests', 'listAdminGarages', 'createShareLinks', 'listShareLinks', 'revokeShareLink', 'viewSharedRequest', 'getSharedRequestPhoto', 'openSharedRequest']) {
  require(`../src/functions/${file}`);
}

const logged = [];
const context = { log: () => {}, warn: () => {}, error: (...args) => logged.push(args) };

const publicView = (overrides = {}) => ({
  linkId: 'link-1',
  requestId: GUID_A,
  createdAt: new Date('2026-10-09T09:00:00Z'),
  car: { make: 'BMW', model: '3 Serie', buildYear: 2019 },
  damageType: 'lakschade',
  location: 'right',
  postalArea: '3511',
  images: [{ blobPath: 'damage-reports/x/1.jpg', contentType: 'image/jpeg' }, { blobPath: 'damage-reports/x/2.heic', contentType: 'image/heic' }],
  ...overrides,
});

test.beforeEach(() => {
  logged.length = 0;
  stubs.requireAdmin = () => ({ adminId: 'admin-1' });
  stubs.isAdminId = (id) => id === 'admin-1';
  stubs.getPublicView = async () => publicView();
  stubs.recordView = async () => {};
  stubs.recordClick = async () => {};
  stubs.readImage = async () => Buffer.from('JPEGDATA');
  stubs.listOpenRequests = async () => [];
  stubs.listApprovedGarages = async () => [];
  stubs.createLinks = async () => ({ links: [] });
  stubs.listLinks = async () => ({ stats: {}, links: [] });
  stubs.revokeLink = async () => true;
});

// ---------- routes ----------

test('the administrator endpoints live under /api/backoffice, never under /api/admin', () => {
  // In production every /api/admin/... request was answered with an empty 404 before it reached the function: "admin" is a name Azure
  // Functions and App Service keep for their own management endpoints. The dashboard then never found out that the user is an
  // administrator. Do not name a route "admin".
  const adminFunctions = ['adminMe', 'listAdminRepairRequests', 'listAdminGarages', 'createShareLinks', 'listShareLinks', 'revokeShareLink'];
  for (const name of adminFunctions) {
    assert.match(routes[name], /^backoffice\//, `${name}: ${routes[name]}`);
  }
  for (const [name, route] of Object.entries(routes)) {
    assert.doesNotMatch(route, /^admin(\/|$)/i, `${name} must not use a route that starts with "admin": ${route}`);
  }
});

// ---------- the public page ----------

const page = ({ token = TOKEN, method = 'GET', ua = PHONE, query = '' } = {}) =>
  handlers.viewSharedRequest(
    { method, params: { token }, query: new URLSearchParams(query), headers: new Headers(ua === undefined ? {} : { 'user-agent': ua }) },
    context,
  );

test('the page of a working link shows the request, with the preview tags, and is not indexed or cached', async () => {
  const response = await page();

  assert.strictEqual(response.status, 200);
  assert.match(response.body, /og:title" content="Nieuwe reparatieaanvraag: BMW 3 Serie/);
  assert.match(response.body, new RegExp(`og:image" content="https://share.test/api/s/${TOKEN}/photo/1"`));
  assert.match(response.headers['Content-Type'], /text\/html/);
  assert.match(response.headers['X-Robots-Tag'], /noindex/);
  assert.strictEqual(response.headers['Cache-Control'], 'no-store');
  assert.strictEqual(response.headers['Referrer-Policy'], 'no-referrer');
  assert.match(response.headers['Content-Security-Policy'], /default-src 'none'/);
});

test('a person who opens the link counts as an open', async () => {
  const calls = [];
  stubs.recordView = async (...args) => { calls.push(args); };

  await page({ ua: PHONE });

  assert.deepStrictEqual(calls, [['link-1', { preview: false }]]);
});

test('WhatsApp fetching the page for its preview is recorded as a preview, never as an open', async () => {
  const calls = [];
  stubs.recordView = async (...args) => { calls.push(args); };

  const response = await page({ ua: WHATSAPP });

  assert.strictEqual(response.status, 200); // the preview still gets the full page with the tags
  assert.match(response.body, /og:image/);
  assert.deepStrictEqual(calls, [['link-1', { preview: true }]]);
});

test('a HEAD request and the admin\'s own "open" (?nc=1) are not counted at all', async () => {
  stubs.recordView = async () => assert.fail('must not be called');

  assert.strictEqual((await page({ method: 'HEAD' })).status, 200);
  assert.strictEqual((await page({ query: 'nc=1' })).status, 200);
});

test('a problem while counting never breaks the page', async () => {
  stubs.recordView = async () => { throw new Error('database down'); };

  const response = await page();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(logged.length, 1);
});

test('a bad, unknown, expired or revoked link all give the same page, so nothing can be learned from it', async () => {
  stubs.getPublicView = async () => assert.fail('a malformed token must not reach the database');
  const malformed = await page({ token: 'nope' });

  stubs.getPublicView = async () => null; // unknown, expired, revoked and "request taken" all look like this
  const unknown = await page();

  for (const response of [malformed, unknown]) {
    assert.strictEqual(response.status, 404);
    assert.match(response.body, /Deze link is niet meer geldig/);
    assert.doesNotMatch(response.body, /og:image/);
  }
  assert.strictEqual(malformed.body, unknown.body);
});

test('the page answers with an error page, not a crash, when the database fails', async () => {
  stubs.getPublicView = async () => { throw new Error('boom'); };
  const response = await page();
  assert.strictEqual(response.status, 500);
  assert.doesNotMatch(response.body, /boom/);
});

// ---------- the photos behind the preview ----------

const photo = ({ token = TOKEN, n = '1' } = {}) => handlers.getSharedRequestPhoto({ params: { token, n }, headers: new Headers() }, context);

test('a photo is served through the API, so the preview address keeps working', async () => {
  let read;
  stubs.readImage = async (blobPath) => { read = blobPath; return Buffer.from('JPEGDATA'); };

  const response = await photo({ n: '1' });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(read, 'damage-reports/x/1.jpg');
  assert.strictEqual(response.body.toString(), 'JPEGDATA');
  assert.strictEqual(response.headers['Content-Type'], 'image/jpeg');
  assert.match(response.headers['Cache-Control'], /max-age=3600/);
});

test('photo: 404 for a bad token, a bad number, a missing photo, a format that cannot be shown and a link that does not work', async () => {
  stubs.getPublicView = async () => assert.fail('must not be called for a malformed request');
  stubs.readImage = async () => assert.fail('must not be called');
  for (const args of [{ token: 'nope' }, { n: '0' }, { n: '51' }, { n: 'abc' }, { n: '1.5' }, { n: '' }]) {
    assert.strictEqual((await photo(args)).status, 404, JSON.stringify(args));
  }

  stubs.getPublicView = async () => publicView();
  assert.strictEqual((await photo({ n: '2' })).status, 404); // HEIC
  assert.strictEqual((await photo({ n: '3' })).status, 404); // there is no third photo

  stubs.getPublicView = async () => null;
  assert.strictEqual((await photo()).status, 404); // expired, revoked, unknown

  stubs.getPublicView = async () => publicView();
  stubs.readImage = async () => null; // blob is gone
  assert.strictEqual((await photo()).status, 404);
});

// ---------- the administrator endpoints ----------

const admin = (name, { body, params = {}, json } = {}) =>
  handlers[name]({ params, headers: new Headers(), json: json ?? (async () => body) }, context);

test('every administrator endpoint passes on the 401 and 403 of the administrator check, without touching the database', async () => {
  for (const status of [401, 403]) {
    stubs.requireAdmin = () => ({ response: { status, jsonBody: { error: 'x' } } });
    for (const name of ['listAdminRepairRequests', 'listAdminGarages', 'createShareLinks', 'listShareLinks', 'revokeShareLink']) {
      stubs.listOpenRequests = stubs.listApprovedGarages = stubs.createLinks = stubs.listLinks = stubs.revokeLink = async () => assert.fail(`${name} touched the database`);
      assert.strictEqual((await admin(name, { body: {}, params: { id: GUID_A } })).status, status, `${name} ${status}`);
    }
  }
});

const me = (headers) => handlers.adminMe({ headers: new Headers(headers) }, context);

test('adminMe tells any signed-in user whether they are an administrator, and answers 401 without a login', async () => {
  const saved = { ...process.env };
  process.env.ALLOW_DEV_AUTH = 'true';
  delete process.env.WEBSITE_SITE_NAME;
  try {
    assert.deepStrictEqual((await me({ 'x-dev-user-id': 'admin-1' })).jsonBody, { isAdmin: true });
    const garageUser = await me({ 'x-dev-user-id': 'a-garage-user' });
    assert.strictEqual(garageUser.status, 200); // not a 403: no failing request on every page for normal users
    assert.deepStrictEqual(garageUser.jsonBody, { isAdmin: false });
    assert.strictEqual((await me({})).status, 401);
  } finally {
    process.env = saved;
  }
});

test('the requests to choose from are all open requests, not from one garage\'s point of view', async () => {
  let asked = 'not called';
  stubs.listOpenRequests = async (garageId) => { asked = garageId; return [{ id: 'r1' }]; };

  const response = await admin('listAdminRepairRequests');

  assert.strictEqual(asked, null);
  assert.deepStrictEqual(response.jsonBody, { repairRequests: [{ id: 'r1' }] });
});

test('the garages to choose from are the approved ones', async () => {
  stubs.listApprovedGarages = async () => [{ id: GUID_B, companyName: 'Van Dijk', city: 'Utrecht' }];
  const response = await admin('listAdminGarages');
  assert.deepStrictEqual(response.jsonBody, { garages: [{ id: GUID_B, companyName: 'Van Dijk', city: 'Utrecht' }] });
});

test('creating links: one per garage, with a ready-to-share address and without the raw token', async () => {
  let received;
  stubs.createLinks = async (args) => {
    received = args;
    return {
      links: [
        { id: 'l1', token: TOKEN, repairRequestId: GUID_A, recipient: { type: 'garage', id: GUID_B, companyName: 'Van Dijk', city: 'Utrecht' }, createdAt: 'c', expiresAt: 'e', existing: false },
        { id: 'l2', token: 'U'.repeat(43), repairRequestId: GUID_A, recipient: { type: 'prospect', id: 'p2', companyName: 'Jansen', city: 'Breda' }, createdAt: 'c', expiresAt: 'e', existing: true },
      ],
    };
  };

  const response = await admin('createShareLinks', { body: { repairRequestId: GUID_A, garageIds: [GUID_B, 'ignored-by-stub'], expiresInDays: 14 } });

  assert.strictEqual(response.status, 422); // the second id is not a GUID: nothing is created
  assert.strictEqual(received, undefined);

  const ok = await admin('createShareLinks', { body: { repairRequestId: GUID_A, garageIds: [GUID_B, '33333333-3333-3333-3333-333333333333'], expiresInDays: 14 } });

  assert.strictEqual(ok.status, 201);
  assert.deepStrictEqual(received, { repairRequestId: GUID_A, garageIds: [GUID_B, '33333333-3333-3333-3333-333333333333'], prospectIds: [], expiresInDays: 14, createdBy: 'admin-1' });
  assert.strictEqual(ok.jsonBody.links[0].url, `https://share.test/api/s/${TOKEN}`);
  assert.strictEqual(ok.jsonBody.links[1].existing, true);
  assert.ok(ok.jsonBody.links.every((link) => !('token' in link)));
});

test('creating links: 400 for bad JSON, 422 for invalid input, 404 for a request that is gone, 422 for a garage that does not exist', async () => {
  assert.strictEqual((await admin('createShareLinks', { json: async () => { throw new Error('bad json'); } })).status, 400);
  assert.strictEqual((await admin('createShareLinks', { body: { garageIds: [] } })).status, 422);

  stubs.createLinks = async () => ({ notFound: true });
  assert.strictEqual((await admin('createShareLinks', { body: { repairRequestId: GUID_A, garageIds: [GUID_B] } })).status, 404);

  stubs.createLinks = async () => ({ unknownGarageIds: [GUID_B] });
  const unknown = await admin('createShareLinks', { body: { repairRequestId: GUID_A, garageIds: [GUID_B] } });
  assert.strictEqual(unknown.status, 422);
  assert.match(unknown.jsonBody.details.garageIds, new RegExp(GUID_B));
});

test('creating links: a database error becomes a plain 500 without details', async () => {
  stubs.createLinks = async () => { throw new Error('Login failed for user sa'); };
  const response = await admin('createShareLinks', { body: { repairRequestId: GUID_A, garageIds: [GUID_B] } });
  assert.strictEqual(response.status, 500);
  assert.doesNotMatch(JSON.stringify(response.jsonBody), /Login failed/);
});

test('the list gives each link its address and the stats, and never the raw token', async () => {
  stubs.listLinks = async () => ({
    stats: { totalLinks: 2, openedLinks: 1, openRate: 0.5, averageSecondsToOpen: 3600 },
    links: [{ id: 'l1', token: TOKEN, status: 'active', openCount: 1 }],
  });

  const { jsonBody } = await admin('listShareLinks');

  assert.deepStrictEqual(jsonBody.stats, { totalLinks: 2, openedLinks: 1, openRate: 0.5, averageSecondsToOpen: 3600 });
  assert.strictEqual(jsonBody.links[0].url, `https://share.test/api/s/${TOKEN}`);
  assert.strictEqual('token' in jsonBody.links[0], false);
});

test('revoking: 204 when revoked, 404 for a link that does not exist, and a non-GUID never reaches the database', async () => {
  assert.strictEqual((await admin('revokeShareLink', { params: { id: GUID_A } })).status, 204);

  stubs.revokeLink = async () => false;
  assert.strictEqual((await admin('revokeShareLink', { params: { id: GUID_A } })).status, 404);

  stubs.revokeLink = async () => assert.fail('must not be called');
  assert.strictEqual((await admin('revokeShareLink', { params: { id: "1'; DROP TABLE x;--" } })).status, 404);
});

// ---------- the button on the public page ----------

const click = ({ token = TOKEN, method = 'GET', ua = PHONE, query = '' } = {}) =>
  handlers.openSharedRequest(
    { method, params: { token }, query: new URLSearchParams(query), headers: new Headers(ua === undefined ? {} : { 'user-agent': ua }) },
    context,
  );

test('the button counts a click by a person and sends a garage on to the request in the dashboard', async () => {
  let clicked;
  stubs.recordClick = async (linkId) => { clicked = linkId; };

  const response = await click();

  assert.strictEqual(response.status, 302);
  assert.strictEqual(response.headers.Location, `https://garage.test/aanvragen/${GUID_A}`);
  assert.strictEqual(response.headers['Cache-Control'], 'no-store');
  assert.strictEqual(clicked, 'link-1');
});

test('a prospect is sent to the sign-up form, with the link as its invitation', async () => {
  stubs.getPublicView = async () => publicView({ recipientType: 'prospect' });
  const response = await click();
  assert.strictEqual(response.status, 302);
  assert.ok(response.headers.Location.endsWith(`/aanmelden-garage.html#uitnodiging=${TOKEN}`), response.headers.Location);
});

test('link previewers, HEAD requests and the admin test (?nc=1) are sent on but not counted; a failure to count never stops anyone', async () => {
  let clicks = 0;
  stubs.recordClick = async () => { clicks += 1; };
  for (const options of [{ ua: WHATSAPP }, { ua: '' }, { method: 'HEAD' }, { query: 'nc=1' }]) {
    assert.strictEqual((await click(options)).status, 302, JSON.stringify(options));
  }
  assert.strictEqual(clicks, 0);

  stubs.recordClick = async () => { throw new Error('database busy'); };
  assert.strictEqual((await click()).status, 302);
});

test('the button of a link that no longer works shows the same page as the link itself', async () => {
  stubs.getPublicView = async () => null;
  const gone = await click();
  assert.strictEqual(gone.status, 404);
  assert.match(gone.body, /niet meer geldig/);
  assert.strictEqual((await click({ token: 'short' })).status, 404);
});
