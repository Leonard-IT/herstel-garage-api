'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateRegistration, isValidIban } = require('../src/lib/validation');

const valid = () => ({
  companyName: 'Garage Test B.V.',
  kvkNumber: '12345678',
  street: 'Teststraat 1',
  postalCode: '1234 ab',
  city: 'Utrecht',
  contact: { firstName: 'Jan', lastName: 'Jansen', email: 'Jan@Example.nl', phone: '06 12345678' },
  serviceArea: 'Utrecht en omgeving',
  specializations: ['lakschade'],
  accreditations: [],
  hasLiabilityInsurance: true,
  iban: 'NL91 ABNA 0417 1643 00',
  acceptedTerms: true,
});

test('accepts and normalizes a valid payload', () => {
  const { value, errors } = validateRegistration(valid());
  assert.strictEqual(errors, undefined);
  assert.strictEqual(value.postalCode, '1234AB');
  assert.strictEqual(value.iban, 'NL91ABNA0417164300');
  assert.strictEqual(value.contact.email, 'jan@example.nl');
});

test('rejects missing required fields', () => {
  const { errors } = validateRegistration({});
  for (const f of ['companyName', 'kvkNumber', 'street', 'postalCode', 'city', 'contact.email', 'serviceArea', 'iban', 'acceptedTerms']) {
    assert.ok(errors[f], `expected error for ${f}`);
  }
});

test('rejects bad kvk, iban and unchecked insurance', () => {
  const body = { ...valid(), kvkNumber: '123', iban: 'NL00ABNA0417164300', hasLiabilityInsurance: false };
  const { errors } = validateRegistration(body);
  assert.ok(errors.kvkNumber && errors.iban && errors.hasLiabilityInsurance);
});

test('iban checksum', () => {
  assert.ok(isValidIban('NL91ABNA0417164300'));
  assert.ok(!isValidIban('NL91ABNA0417164301'));
});
