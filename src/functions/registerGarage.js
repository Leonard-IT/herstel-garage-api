'use strict';

const { app } = require('@azure/functions');
const { validateRegistration } = require('../lib/validation');
const { createGarage } = require('../lib/garageRepository');
const { isValidToken } = require('../lib/shareToken');
const { tryGeocode } = require('../lib/geocoder');

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

    // Signing up through the link of an invitation (the sign-up form passes the share link's token): approved straight away, see
    // createGarage. A missing or malformed token is simply an ordinary registration.
    const invitationToken = isValidToken(body?.invitationToken) ? body.invitationToken : null;

    try {
      const coordinates = await tryGeocode(value.postalCode, context);
      const garage = await createGarage(value, { invitationToken, coordinates });
      context.log(`Garage registered: ${garage.id} (${garage.status}${garage.invited ? ', through an invitation' : ''})`);
      return { status: 201, jsonBody: garage };
    } catch (err) {
      if (err.statusCode === 409) {
        return {
          status: 409,
          jsonBody: { error: 'already_registered', message: 'A garage with this KvK number is already registered' },
        };
      }
      context.error('Garage registration failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Registration failed, please try again later' } };
    }
  },
});
