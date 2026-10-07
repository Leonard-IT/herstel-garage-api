'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateRepairRequest, validateUploadUrlRequest } = require('../src/lib/repairValidation');

const path = (n = 1, ext = 'jpg') => `pending/00000000-0000-4000-8000-00000000000${n}.${ext}`;

const valid = () => ({
  submissionId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  postalCode: '3511 ab',
  customer: { firstName: 'Piet', lastName: 'Pietersen', email: 'Piet@Example.nl', phone: '06 12345678' },
  car: { licensePlate: 'ab-123-c', make: 'Volkswagen', model: 'Golf', buildYear: 2018 },
  damages: [{
    description: 'Deuk in het linker voorportier',
    damageType: 'carrosserie',
    location: 'left',
    images: [path(1), path(2, 'png')],
    preferences: ['rental-car', 'rental-car', 'fast-repair'],
  }],
});

test('accepts and normalizes a valid payload', () => {
  const { value, errors } = validateRepairRequest(valid());
  assert.strictEqual(errors, undefined);
  assert.strictEqual(value.customer.email, 'piet@example.nl');
  assert.strictEqual(value.car.licensePlate, 'AB123C');
  assert.strictEqual(value.postalCode, '3511AB');
  assert.deepStrictEqual(value.damages[0].preferences, ['rental-car', 'fast-repair']);
});

test('rejects an empty payload with all required fields', () => {
  const { errors } = validateRepairRequest({});
  for (const f of ['customer.firstName', 'customer.lastName', 'customer.email', 'customer.phone', 'car.licensePlate', 'car.make', 'car.model', 'postalCode', 'submissionId', 'damages']) {
    assert.ok(errors[f], `expected error for ${f}`);
  }
});

test('requires description and at least one image per damage', () => {
  const body = valid();
  body.damages = [{ description: ' ', images: [] }];
  const { errors } = validateRepairRequest(body);
  assert.ok(errors['damages[0].description'] && errors['damages[0].images']);
});

test('rejects image paths that were not issued by the upload endpoint', () => {
  for (const bad of ['../secret.jpg', 'damage-reports/x/1.jpg', 'pending/not-a-guid.jpg', 'https://evil.example/a.jpg']) {
    const body = valid();
    body.damages[0].images = [bad];
    assert.ok(validateRepairRequest(body).errors['damages[0].images'], bad);
  }
});

test('rejects an image used twice, also across damages', () => {
  const body = valid();
  body.damages.push({ description: 'Kras', images: [path(1)] });
  assert.ok(validateRepairRequest(body).errors['damages[1].images']);
});

test('rejects bad email, plate, year and location', () => {
  const body = valid();
  body.customer.email = 'nope';
  body.car.licensePlate = '12';
  body.car.buildYear = 1800;
  body.damages[0].location = 'moon';
  const { errors } = validateRepairRequest(body);
  assert.ok(errors['customer.email'] && errors['car.licensePlate'] && errors['car.buildYear'] && errors['damages[0].location']);
});

test('upload url request only allows image content types', () => {
  assert.deepStrictEqual(validateUploadUrlRequest({ files: [{ contentType: 'image/JPEG' }] }).value.files, [{ contentType: 'image/jpeg', extension: 'jpg' }]);
  assert.ok(validateUploadUrlRequest({ files: [{ contentType: 'application/pdf' }] }).errors['files[0].contentType']);
  assert.ok(validateUploadUrlRequest({ files: [] }).errors.files);
});

test('requires a damage type from the known list', () => {
  const body = valid();
  body.damages[0].damageType = 'sparkle';
  assert.ok(validateRepairRequest(body).errors['damages[0].damageType']);
  delete body.damages[0].damageType;
  assert.ok(validateRepairRequest(body).errors['damages[0].damageType']);
});

test('requires a valid postal code and a submission id', () => {
  for (const postalCode of ['', '0123 AB', '1234', '1234 A']) {
    assert.ok(validateRepairRequest({ ...valid(), postalCode }).errors.postalCode, postalCode);
  }
  assert.ok(validateRepairRequest({ ...valid(), submissionId: 'not-a-guid' }).errors.submissionId);
});
