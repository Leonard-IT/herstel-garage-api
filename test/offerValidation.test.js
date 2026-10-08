'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateOffer, todayInNetherlands, isCalendarDate, VALIDITY_HOURS, MAX_DAYS_AHEAD } = require('../src/lib/offerValidation');

// 8 October 2026, 12:00 UTC = 14:00 in the Netherlands (summer time).
const now = new Date('2026-10-08T12:00:00Z');

test('offers the validity periods 12, 24 and 48 hours', () => {
  assert.deepStrictEqual(VALIDITY_HOURS, [12, 24, 48]);
});

test('accepts a valid offer, for today and for a later day', () => {
  assert.deepStrictEqual(validateOffer({ availableFrom: '2026-10-08', validityHours: 24 }, now).value, {
    availableFrom: '2026-10-08',
    validityHours: 24,
  });
  assert.strictEqual(validateOffer({ availableFrom: '2026-12-01', validityHours: 12 }, now).errors, undefined);
  assert.strictEqual(validateOffer({ availableFrom: '2027-10-08', validityHours: 48 }, now).errors, undefined);
});

test('uses the date in the Netherlands, not the server clock (UTC)', () => {
  // 22:30 UTC on 8 October is already 00:30 on 9 October in the Netherlands.
  const lateEvening = new Date('2026-10-08T22:30:00Z');
  assert.strictEqual(todayInNetherlands(lateEvening), '2026-10-09');
  assert.ok(validateOffer({ availableFrom: '2026-10-08', validityHours: 24 }, lateEvening).errors.availableFrom);
  assert.strictEqual(validateOffer({ availableFrom: '2026-10-09', validityHours: 24 }, lateEvening).errors, undefined);
});

test('rejects a date in the past or too far ahead', () => {
  assert.match(validateOffer({ availableFrom: '2026-10-07', validityHours: 24 }, now).errors.availableFrom, /past/);
  assert.match(validateOffer({ availableFrom: '2027-10-09', validityHours: 24 }, now).errors.availableFrom, new RegExp(String(MAX_DAYS_AHEAD)));
});

test('rejects things that are not a real calendar date', () => {
  for (const bad of [undefined, null, '', 'morgen', '8-10-2026', '2026-10-8', '2026-02-30', '2026-13-01', 20261008, '2026-10-08T00:00:00Z']) {
    assert.ok(validateOffer({ availableFrom: bad, validityHours: 24 }, now).errors.availableFrom, String(bad));
  }
  assert.strictEqual(isCalendarDate('2028-02-29'), true); // leap year
  assert.strictEqual(isCalendarDate('2027-02-29'), false);
});

test('only accepts the allowed validity periods, as numbers', () => {
  for (const bad of [undefined, 0, 6, 36, 28, '24', null, 24.5, [24]]) {
    assert.ok(validateOffer({ availableFrom: '2026-10-09', validityHours: bad }, now).errors.validityHours, String(bad));
  }
});

test('reports every problem at once, and rejects a body that is not an object', () => {
  assert.deepStrictEqual(Object.keys(validateOffer({}, now).errors).sort(), ['availableFrom', 'validityHours']);
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.ok(validateOffer(bad, now).errors.body, String(bad));
  }
});
