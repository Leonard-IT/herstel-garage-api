'use strict';

const { app } = require('@azure/functions');
const { validateRegistration } = require('../lib/validation');
const { createGarage } = require('../lib/garageRepository');

app.http('registerGarage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'garages/register',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json', message: 'Request body must be valid JSON' } };
    }

    const { value, errors } = validateRegistration(body);
    if (errors) {
      return { status: 422, jsonBody: { error: 'validation_failed', message: 'Validation failed', details: errors } };
    }

    try {
      const garage = await createGarage(value);
      context.log(`Garage registered: ${garage.id}`);
      return { status: 201, jsonBody: garage };
    } catch (err) {
      if (err.statusCode === 409) {
        return {
          status: 409,
          jsonBody: { error: 'already_registered', message: 'A garage with this KvK number is already registered' },
        };
      }
      context.error('Garage registration failed', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Registration failed, please try again later' } };
    }
  },
});
