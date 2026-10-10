'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { haversineKm, roughDistanceKm } = require('../src/lib/distance');

// Postal code centroids, roughly.
const UTRECHT = { latitude: 52.0907, longitude: 5.1214 };
const AMSTERDAM = { latitude: 52.3676, longitude: 4.9041 };
const GRONINGEN = { latitude: 53.2194, longitude: 6.5665 };

test('the distance between two places is the straight line, close to the known value', () => {
  assert.ok(Math.abs(haversineKm(UTRECHT, AMSTERDAM) - 34) < 1.5, 'Utrecht - Amsterdam is about 34 km');
  assert.ok(Math.abs(haversineKm(UTRECHT, GRONINGEN) - 159) < 3, 'Utrecht - Groningen is about 159 km');
});

test('the distance is symmetric and zero for the same place', () => {
  assert.strictEqual(haversineKm(UTRECHT, UTRECHT), 0);
  assert.ok(Math.abs(haversineKm(UTRECHT, GRONINGEN) - haversineKm(GRONINGEN, UTRECHT)) < 1e-9);
});

test('the distance shown is in whole kilometres', () => {
  assert.strictEqual(roughDistanceKm(UTRECHT, AMSTERDAM), 34);
  assert.strictEqual(roughDistanceKm(UTRECHT, UTRECHT), 0);
});

test('the distance is unknown (null) when either place is unknown', () => {
  const none = { latitude: null, longitude: null };
  assert.strictEqual(roughDistanceKm(none, AMSTERDAM), null);
  assert.strictEqual(roughDistanceKm(UTRECHT, none), null);
  assert.strictEqual(roughDistanceKm(undefined, AMSTERDAM), null);
  assert.strictEqual(roughDistanceKm({ latitude: undefined, longitude: undefined }, AMSTERDAM), null);
});

test('coordinates that are not numbers count as unknown instead of producing NaN', () => {
  assert.strictEqual(roughDistanceKm({ latitude: '52.09', longitude: '5.12' }, AMSTERDAM), null);
});
