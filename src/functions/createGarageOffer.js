'use strict';

const { app } = require('@azure/functions');
const { requireGarage } = require('../lib/garageAuth');
const { validateOffer } = require('../lib/offerValidation');
const { createOffer } = require('../lib/offerRepository');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = { status: 404, jsonBody: { error: 'not_found', message: 'Repair request not found' } };

app.http('createGarageOffer', {
  methods: ['POST'],
  authLevel: 'anonymous', // the caller is authenticated by App Service Authentication and checked in requireGarage
  route: 'garage/repair-requests/{id}/offers',
  handler: async (request, context) => {
    try {
      const { response, garageId, userId } = await requireGarage(request, context);
      if (response) return response;

      const { id } = request.params;
      if (!GUID.test(id)) return notFound;

      let body;
      try {
        body = await request.json();
      } catch {
        return { status: 400, jsonBody: { error: 'invalid_json', message: 'Request body must be valid JSON' } };
      }

      const { value, errors } = validateOffer(body);
      if (errors) {
        return { status: 422, jsonBody: { error: 'validation_failed', message: 'Validation failed', details: errors } };
      }

      const offer = await createOffer({ repairRequestId: id, garageId, userId, ...value });
      // Same answer for "does not exist" and "no longer open": a garage learns nothing about requests it cannot see.
      if (!offer) return notFound;

      context.log(`Offer ${offer.id} made on request ${id}`);
      return { status: 201, jsonBody: offer };
    } catch (err) {
      if (err.statusCode === 409 && err.code === 'in_option') {
        // Reserved for another garage until its offer expires. Deliberately says nothing about which garage or for how long.
        return { status: 409, jsonBody: { error: 'in_option', message: 'This request is in option with another garage' } };
      }
      if (err.statusCode === 409) {
        return {
          status: 409,
          jsonBody: { error: 'already_offered', message: 'Your garage already has an active offer on this request' },
        };
      }
      context.error('Creating offer failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not create the offer, please try again later' } };
    }
  },
});
