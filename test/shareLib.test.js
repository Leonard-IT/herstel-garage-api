'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createToken, isValidToken, shareBaseUrl, shareUrl, dashboardUrl, isPreviewBot } = require('../src/lib/shareToken');
const { validateCreateLinks, MAX_GARAGES_PER_REQUEST } = require('../src/lib/shareValidation');
const { adminIds, isAdminId, requireAdmin } = require('../src/lib/adminAuth');
const { buildStats, linkStatus } = require('../src/lib/shareLinkRepository');
const { renderSharePage, renderGonePage, describeRequest, displayablePhotos, escapeHtml, timeAgo } = require('../src/lib/sharePage');

const GUID_A = '11111111-1111-1111-1111-111111111111';
const GUID_B = '22222222-2222-2222-2222-222222222222';

// ---------- tokens ----------

test('a token is 43 url-safe characters and every one is different', () => {
  const tokens = new Set(Array.from({ length: 200 }, createToken));
  assert.strictEqual(tokens.size, 200);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('only well-formed tokens are accepted before the database is asked', () => {
  assert.strictEqual(isValidToken(createToken()), true);
  for (const bad of [undefined, null, '', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}!`, `${'x'.repeat(42)}/`, 42, ['a'.repeat(43)]]) {
    assert.strictEqual(isValidToken(bad), false, String(bad));
  }
});

test('the link address: SHARE_BASE_URL wins, then the Function App host, then localhost', () => {
  const token = 'T'.repeat(43);
  assert.strictEqual(shareUrl(token, { SHARE_BASE_URL: 'https://share.snelhersteld.nl/', WEBSITE_HOSTNAME: 'fn.azurewebsites.net' }), `https://share.snelhersteld.nl/s/${token}`);
  assert.strictEqual(shareUrl(token, { WEBSITE_HOSTNAME: 'fn.azurewebsites.net' }), `https://fn.azurewebsites.net/api/s/${token}`);
  assert.strictEqual(shareBaseUrl({}), 'http://localhost:7071/api');
  assert.strictEqual(dashboardUrl({}), 'https://garage.snelhersteld.nl');
  assert.strictEqual(dashboardUrl({ DASHBOARD_URL: 'https://example.test/' }), 'https://example.test');
});

// ---------- who is a person and who is a link previewer ----------

test('link previewers are recognised, so a preview is not counted as an open', () => {
  const previewers = [
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'TelegramBot (like TwitterBot)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'SkypeUriPreview Preview/0.5',
    'curl/8.4.0',
    'python-requests/2.31.0',
    '',
    undefined,
  ];
  for (const ua of previewers) assert.strictEqual(isPreviewBot(ua), true, String(ua));
});

test('people with a normal browser are not mistaken for a previewer', () => {
  const people = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ];
  for (const ua of people) assert.strictEqual(isPreviewBot(ua), false, ua);
});

// ---------- validation ----------

test('accepts a request with garages and defaults to 7 days', () => {
  const { value, errors } = validateCreateLinks({ repairRequestId: GUID_A.toUpperCase(), garageIds: [GUID_B, GUID_B.toUpperCase()] });
  assert.strictEqual(errors, undefined);
  assert.deepStrictEqual(value, { repairRequestId: GUID_A, garageIds: [GUID_B], expiresInDays: 7 });
});

test('rejects a missing request, no garages, bad ids, too many garages and a bad lifetime', () => {
  assert.ok(validateCreateLinks({ garageIds: [GUID_B] }).errors.repairRequestId);
  assert.ok(validateCreateLinks({ repairRequestId: GUID_A, garageIds: [] }).errors.garageIds);
  assert.ok(validateCreateLinks({ repairRequestId: GUID_A }).errors.garageIds);
  assert.ok(validateCreateLinks({ repairRequestId: GUID_A, garageIds: ['nope'] }).errors.garageIds);
  const many = Array.from({ length: MAX_GARAGES_PER_REQUEST + 1 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  assert.ok(validateCreateLinks({ repairRequestId: GUID_A, garageIds: many }).errors.garageIds);
  for (const days of [0, -1, 91, 1.5, '7']) {
    assert.ok(validateCreateLinks({ repairRequestId: GUID_A, garageIds: [GUID_B], expiresInDays: days }).errors.expiresInDays, String(days));
  }
  assert.strictEqual(validateCreateLinks({ repairRequestId: GUID_A, garageIds: [GUID_B], expiresInDays: 30 }).value.expiresInDays, 30);
  assert.ok(validateCreateLinks(null).errors.body);
});

// ---------- administrators ----------

test('administrators come from ADMIN_USER_IDS; empty means nobody', () => {
  assert.deepStrictEqual(adminIds({ ADMIN_USER_IDS: ' ABC-1 , def-2,, ' }), ['abc-1', 'def-2']);
  assert.strictEqual(isAdminId('ABC-1', { ADMIN_USER_IDS: 'abc-1' }), true);
  assert.strictEqual(isAdminId('other', { ADMIN_USER_IDS: 'abc-1' }), false);
  assert.strictEqual(isAdminId('abc-1', { ADMIN_USER_IDS: '' }), false);
  assert.strictEqual(isAdminId('abc-1', {}), false);
  assert.strictEqual(isAdminId(null, { ADMIN_USER_IDS: 'abc-1' }), false);
});

test('requireAdmin: 401 without a login, 403 for someone who is not an administrator, ok for an administrator', () => {
  const saved = { ...process.env };
  process.env.ALLOW_DEV_AUTH = 'true';
  delete process.env.WEBSITE_SITE_NAME;
  process.env.ADMIN_USER_IDS = 'admin-1';
  try {
    const call = (headers) => requireAdmin({ headers: new Headers(headers) });
    assert.strictEqual(call({}).response.status, 401);
    assert.strictEqual(call({ 'x-dev-user-id': 'someone' }).response.status, 403);
    assert.deepStrictEqual(call({ 'x-dev-user-id': 'admin-1' }), { adminId: 'admin-1' });
    process.env.ADMIN_USER_IDS = '';
    assert.strictEqual(call({ 'x-dev-user-id': 'admin-1' }).response.status, 403); // closed until it is set
  } finally {
    process.env = saved;
  }
});

// ---------- the numbers on top of the page ----------

test('stats: how many links, how many opened, the open rate and the average time to open', () => {
  assert.deepStrictEqual(buildStats({ Total: 10, Opened: 4, AverageSecondsToOpen: 5400.4 }), {
    totalLinks: 10,
    openedLinks: 4,
    openRate: 0.4,
    averageSecondsToOpen: 5400,
  });
});

test('stats without links or without opens have no rate or average instead of dividing by zero', () => {
  assert.deepStrictEqual(buildStats({ Total: 0, Opened: 0, AverageSecondsToOpen: null }), {
    totalLinks: 0,
    openedLinks: 0,
    openRate: null,
    averageSecondsToOpen: null,
  });
  assert.deepStrictEqual(buildStats({ Total: 3, Opened: 0, AverageSecondsToOpen: null }).openRate, 0);
  assert.strictEqual(buildStats({ Total: 3, Opened: 0, AverageSecondsToOpen: null }).averageSecondsToOpen, null);
});

test('a link is revoked, expired or active, in that order of importance', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const later = new Date('2026-10-10T12:00:00Z');
  const earlier = new Date('2026-10-08T12:00:00Z');
  assert.strictEqual(linkStatus({ RevokedAt: earlier, ExpiresAt: later }, now), 'revoked');
  assert.strictEqual(linkStatus({ RevokedAt: earlier, ExpiresAt: earlier }, now), 'revoked');
  assert.strictEqual(linkStatus({ RevokedAt: null, ExpiresAt: earlier }, now), 'expired');
  assert.strictEqual(linkStatus({ RevokedAt: null, ExpiresAt: later }, now), 'active');
});

// ---------- the public page ----------

const view = (overrides = {}) => ({
  linkId: 'l1',
  requestId: GUID_A,
  createdAt: new Date('2026-10-09T09:00:00Z'),
  car: { make: 'BMW', model: '3 Serie', buildYear: 2019 },
  damageType: 'lakschade',
  location: 'right',
  postalArea: '3511',
  images: [
    { blobPath: 'damage-reports/x/1.jpg', contentType: 'image/jpeg' },
    { blobPath: 'damage-reports/x/2.heic', contentType: 'image/heic' },
    { blobPath: 'damage-reports/x/3.png', contentType: 'image/png' },
  ],
  ...overrides,
});
const TOKEN = 'T'.repeat(43);
const options = { token: TOKEN, baseUrl: 'https://share.test/api', dashboardUrl: 'https://garage.test', now: new Date('2026-10-09T12:00:00Z') };

test('the page has the tags a chat app needs for the preview: title, short description and a photo', () => {
  const html = renderSharePage(view(), options);

  assert.match(html, /<meta property="og:title" content="Nieuwe reparatieaanvraag: BMW 3 Serie \(2019\)">/);
  assert.match(html, /<meta property="og:description" content="Lakschade · Rechterzijde · postcode 3511 · 2 foto&#39;s\. Bekijk de aanvraag en doe een aanbod\.">/);
  assert.match(html, new RegExp(`<meta property="og:image" content="https://share.test/api/s/${TOKEN}/photo/1">`));
  assert.match(html, new RegExp(`<meta property="og:url" content="https://share.test/api/s/${TOKEN}">`));
  assert.match(html, /<meta property="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});

test('photos in a format a browser cannot show (HEIC) are left out, but keep their number in the photo address', () => {
  const photos = displayablePhotos(view().images);
  assert.deepStrictEqual(photos.map((p) => p.number), [1, 3]);
  const html = renderSharePage(view(), options);
  assert.ok(html.includes(`/s/${TOKEN}/photo/3`));
  assert.ok(!html.includes(`/s/${TOKEN}/photo/2`));
});

test('the preview picks the first photo that can be shown, even when the first photo is HEIC', () => {
  const html = renderSharePage(view({ images: [{ blobPath: 'a.heic', contentType: 'image/heic' }, { blobPath: 'b.jpg', contentType: 'image/jpeg' }] }), options);
  assert.match(html, new RegExp(`og:image" content="https://share.test/api/s/${TOKEN}/photo/2"`));
});

test('without a photo that can be shown the preview has no image and a plain card', () => {
  const html = renderSharePage(view({ images: [] }), options);
  assert.doesNotMatch(html, /og:image/);
  assert.match(html, /twitter:card" content="summary"/);
  assert.match(describeRequest(view({ images: [] })), /^Lakschade · Rechterzijde · postcode 3511\. Bekijk/);
});

test('the page leads to the request in the dashboard, where the garage logs in to make an offer', () => {
  const html = renderSharePage(view(), options);
  assert.ok(html.includes(`href="https://garage.test/aanvragen/${GUID_A}"`));
  assert.match(html, /Bekijk de aanvraag en doe een aanbod/);
});

test('text from the database is escaped, so a customer cannot inject HTML or script into the page', () => {
  const evil = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = renderSharePage(view({ car: { make: evil, model: evil, buildYear: null }, postalArea: evil }), options);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.ok(!html.includes('"><script'));
  assert.strictEqual(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('the page shows nothing personal, even when the data it is given contains more than it should', () => {
  // The renderer must only use the few fields meant for the public, not whatever else is on the object.
  const leaky = view({
    description: 'Bel mij op 06-12345678 of mail jan@example.nl',
    licensePlate: 'AB-123-C',
    phone: '06-12345678',
    email: 'jan@example.nl',
    contactFirstName: 'Jan',
    preferences: [{ name: 'Leenauto' }],
    myOffer: { id: 'secret-offer' },
  });
  const html = renderSharePage(leaky, options);
  for (const secret of ['06-12345678', 'jan@example.nl', 'AB-123-C', 'Bel mij', 'Jan', 'Leenauto', 'secret-offer']) {
    assert.ok(!html.includes(secret), `the page must not contain ${secret}`);
  }
  assert.doesNotMatch(html, /<script/); // no scripts at all
});

test('the page for a link that no longer works says so, without details and without a preview image', () => {
  const html = renderGonePage({ dashboardUrl: 'https://garage.test' });
  assert.match(html, /Deze link is niet meer geldig/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /og:image/);
});

test('time ago in Dutch', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  assert.strictEqual(timeAgo(new Date('2026-10-09T11:55:00Z'), now), '5 min geleden');
  assert.strictEqual(timeAgo(new Date('2026-10-09T09:00:00Z'), now), '3 uur geleden');
  assert.strictEqual(timeAgo(new Date('2026-10-08T12:00:00Z'), now), '1 dag geleden');
  assert.strictEqual(timeAgo(new Date('2026-10-05T12:00:00Z'), now), '4 dagen geleden');
});
