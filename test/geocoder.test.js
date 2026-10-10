'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { geocodePostalCode, tryGeocode } = require('../src/lib/geocoder');

const answer = (body, init = {}) => async (url, options) => {
  answer.last = { url: new URL(url), options };
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
};

test('a postal code becomes latitude and longitude (PDOK writes the longitude first)', async () => {
  const fetchImpl = answer({ response: { docs: [{ centroide_ll: 'POINT(5.10984409 52.07000023)' }] } });

  const point = await geocodePostalCode('3526KL', { fetchImpl });

  assert.deepStrictEqual(point, { latitude: 52.07, longitude: 5.109844 });
  const { url, options } = answer.last;
  assert.strictEqual(url.hostname, 'api.pdok.nl');
  assert.strictEqual(url.searchParams.get('q'), 'postcode:3526KL');
  assert.ok(options.signal, 'a lookup has a timeout');
});

test('an unknown postal code is null, not an error', async () => {
  assert.strictEqual(await geocodePostalCode('9999ZZ', { fetchImpl: answer({ response: { docs: [] } }) }), null);
  assert.strictEqual(await geocodePostalCode('9999ZZ', { fetchImpl: answer({}) }), null);
  assert.strictEqual(await geocodePostalCode('9999ZZ', { fetchImpl: answer({ response: { docs: [{ centroide_ll: 'nonsense' }] } }) }), null);
});

test('input that is not a postal code is never sent to PDOK', async () => {
  const fetchImpl = async () => assert.fail('must not be called');
  for (const input of ['', '3526', '3526 KL', '0123AB', '3526KL&rows=100', null, undefined]) {
    assert.strictEqual(await geocodePostalCode(input, { fetchImpl }), null, String(input));
  }
});

test('an error from PDOK or the network is thrown, so "unknown" and "try again later" stay apart', async () => {
  await assert.rejects(geocodePostalCode('3526KL', { fetchImpl: answer({}, { ok: false, status: 503 }) }), /503/);
  await assert.rejects(geocodePostalCode('3526KL', { fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
});

test('tryGeocode turns a failed lookup into null and logs it', async () => {
  const warnings = [];
  const context = { warn: (...args) => warnings.push(args) };

  const point = await tryGeocode('3526KL', context, { fetchImpl: async () => { throw new Error('offline'); } });

  assert.strictEqual(point, null);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0][0], /3526KL/);
});
