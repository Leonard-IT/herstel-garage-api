'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { customerStage, buildNextSteps } = require('../src/lib/customerNextSteps');
const { presentCustomerView } = require('../src/lib/customerView');
const { answerError } = require('../src/lib/customerRequestRepository');

const NOW = new Date('2026-10-09T10:00:00Z');
const LATER = '2026-10-10T10:00:00.000Z';
const EARLIER = '2026-10-08T10:00:00.000Z';
const garage = { companyName: 'Autoschade Jansen', address: 'Industrieweg 4, 3511 AB Utrecht', phone: null };
const ids = (result) => result.steps.map((s) => s.id);
const warningIds = (result) => result.warnings.map((w) => w.id);

// ---------- stage ----------

test('an open request waits for an offer, or for the customer while an offer is running', () => {
  assert.strictEqual(customerStage('open', [], NOW), 'waiting_for_offer');
  assert.strictEqual(customerStage('open', [{ status: 'active', expiresAt: LATER }], NOW), 'offer_received');
  assert.strictEqual(customerStage('open', [{ status: 'active', expiresAt: EARLIER }], NOW), 'waiting_for_offer', 'an expired offer does not count');
  assert.strictEqual(customerStage('open', [{ status: 'declined', expiresAt: LATER }], NOW), 'waiting_for_offer');
  assert.strictEqual(customerStage('accepted', [{ status: 'accepted', expiresAt: EARLIER }], NOW), 'accepted');
  assert.strictEqual(customerStage('cancelled', [], NOW), 'cancelled');
});

// ---------- scenarios ----------

test('the car can drive: the customer brings it to the garage, at the garage address', () => {
  const result = buildNextSteps({ stage: 'offer_received', carDrivable: 'yes', carLocation: 'home', garage, expiresAt: LATER, availableFrom: '2026-10-12' });
  const transport = result.steps.find((s) => s.id === 'transport');
  assert.strictEqual(transport.who, 'you');
  assert.match(transport.text, /zelf naar de garage \(Industrieweg 4/);
  assert.deepStrictEqual(warningIds(result), []);
  assert.match(result.steps[0].text, /Pas als je accepteert/, 'before accepting, the customer is told the garage does not have their details yet');
  assert.match(result.steps[0].text, /maandag 12 oktober/);
  assert.match(result.ifNoAnswer, /vervalt/);
});

test('the car cannot drive: do not drive, and the garage arranges transport', () => {
  const result = buildNextSteps({ stage: 'offer_received', carDrivable: 'no', carLocation: 'home', garage, expiresAt: LATER });
  assert.deepStrictEqual(warningIds(result), ['do-not-drive']);
  const transport = result.steps.find((s) => s.id === 'transport');
  assert.strictEqual(transport.who, 'garage');
  assert.match(transport.text, /pechhulp/);
});

test('the car is at a towing yard: storage costs warning and transport via the garage, even if it could drive', () => {
  const result = buildNextSteps({ stage: 'accepted', carDrivable: 'yes', carLocation: 'towing', garage, expiresAt: LATER });
  assert.deepStrictEqual(warningIds(result), ['storage-costs']);
  assert.strictEqual(result.steps.find((s) => s.id === 'transport').who, 'garage');
});

test('not known whether the car can drive (or not asked): a safety check instead of a verdict', () => {
  for (const carDrivable of ['unknown', null, undefined]) {
    const result = buildNextSteps({ stage: 'waiting_for_offer', carDrivable });
    assert.deepStrictEqual(warningIds(result), ['check-drivable'], String(carDrivable));
  }
});

test('an electric car gets the battery warning', () => {
  const result = buildNextSteps({ stage: 'waiting_for_offer', carDrivable: 'yes', damageType: 'ev' });
  assert.deepStrictEqual(warningIds(result), ['ev-safety']);
});

test('preferences add their own steps: pickup, insurance, rental car', () => {
  const plain = buildNextSteps({ stage: 'accepted', carDrivable: 'yes', garage, preferences: [] });
  assert.deepStrictEqual(ids(plain), ['contact', 'transport', 'prepare', 'price']);

  const all = buildNextSteps({ stage: 'accepted', carDrivable: 'yes', garage, preferences: ['pickup-and-delivery', 'insurance-handling', 'rental-car'] });
  assert.deepStrictEqual(ids(all), ['contact', 'transport', 'insurance', 'rental-car', 'prepare', 'price']);
  assert.match(all.steps.find((s) => s.id === 'transport').title, /Ophalen/);
});

test('once accepted, the garage phone number is in the contact step', () => {
  const result = buildNextSteps({ stage: 'accepted', carDrivable: 'yes', garage: { ...garage, phone: '030 1234567' } });
  assert.match(result.title, /geaccepteerd/);
  assert.match(result.steps[0].text, /030 1234567/);
  assert.strictEqual(result.ifNoAnswer, null);
});

test('every stage has a title and only known actors', () => {
  for (const stage of ['waiting_for_offer', 'offer_received', 'accepted', 'in_progress', 'completed', 'cancelled']) {
    const result = buildNextSteps({ stage, garage, expiresAt: LATER });
    assert.ok(result.title, stage);
    for (const step of result.steps) assert.ok(['you', 'garage', 'us'].includes(step.who), `${stage}/${step.id}`);
  }
});

// ---------- the view ----------

const record = (overrides = {}) => ({
  id: 'r1',
  status: 'open',
  createdAt: new Date('2026-10-08T09:00:00Z'),
  postalCode: '3511AB',
  firstName: 'Piet',
  carDrivable: 'yes',
  carLocation: 'home',
  car: { licensePlate: 'AB123C', make: 'Volkswagen', model: 'Golf', buildYear: 2018 },
  damage: { description: 'Deuk', damageType: 'carrosserie', location: 'left' },
  imagePaths: ['damage-reports/x/1.jpg', 'damage-reports/x/2.jpg'],
  preferences: [{ slug: 'rental-car', name: 'Leenauto' }],
  offers: [],
  ...overrides,
});
const offer = (overrides = {}) => ({
  id: 'o1',
  status: 'active',
  availableFrom: '2026-10-12',
  expiresAt: new Date(LATER),
  createdAt: new Date('2026-10-09T09:00:00Z'),
  respondedAt: null,
  garage: {
    id: 'g1', companyName: 'Autoschade Jansen', street: 'Industrieweg 4', postalCode: '3511AB', city: 'Utrecht',
    website: null, phone: '030 1234567', email: 'info@jansen.test', accreditations: ['bovag'],
  },
  ...overrides,
});
const urls = new Map([['damage-reports/x/1.jpg', 'https://storage.test/1.jpg?sig']]);

test('the view shows a running offer without the garage contact details', () => {
  const view = presentCustomerView(record({ offers: [offer()] }), urls, NOW);
  assert.strictEqual(view.request.stage, 'offer_received');
  assert.strictEqual(view.request.postalCode, '3511 AB');
  assert.deepStrictEqual(view.request.images, [{ url: 'https://storage.test/1.jpg?sig' }], 'a photo without a read URL is left out');
  assert.strictEqual(view.offers.length, 1);
  assert.strictEqual(view.offers[0].canRespond, true);
  assert.strictEqual(view.offers[0].garage.address, 'Industrieweg 4, 3511 AB Utrecht');
  assert.strictEqual(view.offers[0].garage.phone, null);
  assert.strictEqual(view.offers[0].garage.email, null);
  assert.strictEqual(view.nextSteps.stage, 'offer_received');
});

test('the view shows the garage contact details once the offer is accepted', () => {
  const view = presentCustomerView(record({ status: 'accepted', offers: [offer({ status: 'accepted', expiresAt: new Date(EARLIER) })] }), urls, NOW);
  assert.strictEqual(view.request.stage, 'accepted');
  assert.strictEqual(view.offers[0].canRespond, false);
  assert.strictEqual(view.offers[0].garage.phone, '030 1234567');
  assert.match(view.nextSteps.steps[0].text, /030 1234567/);
});

test('expired, declined and withdrawn offers are not shown', () => {
  const offers = [offer({ id: 'a', expiresAt: new Date(EARLIER) }), offer({ id: 'b', status: 'declined' }), offer({ id: 'c', status: 'withdrawn' })];
  const view = presentCustomerView(record({ offers }), urls, NOW);
  assert.deepStrictEqual(view.offers, []);
  assert.strictEqual(view.request.stage, 'waiting_for_offer');
});

// ---------- answering an offer ----------

test('accepting: only a running offer on an open request; accepting twice is fine', () => {
  assert.strictEqual(answerError('accept', 'open', 'active', true), null);
  assert.strictEqual(answerError('accept', 'open', 'active', false), 'offer_expired');
  assert.strictEqual(answerError('accept', 'accepted', 'accepted', false), 'repeat');
  assert.strictEqual(answerError('accept', 'accepted', 'declined', true), 'request_closed');
  assert.strictEqual(answerError('accept', 'open', 'withdrawn', true), 'offer_closed');
  assert.strictEqual(answerError('accept', 'open', 'declined', true), 'offer_closed');
});

test('declining: only a running offer; declining twice is fine; an accepted offer cannot be declined here', () => {
  assert.strictEqual(answerError('decline', 'open', 'active', true), null);
  assert.strictEqual(answerError('decline', 'open', 'declined', true), 'repeat');
  assert.strictEqual(answerError('decline', 'open', 'active', false), 'offer_expired');
  assert.strictEqual(answerError('decline', 'accepted', 'accepted', true), 'offer_closed');
});
