'use strict';

const { app } = require('@azure/functions');
const { listActiveSpecializations, listActiveAccreditations } = require('../lib/garageRepository');

// The options of the garage sign-up form, maintained in the database.
function listOptions(name, route, key, list) {
  app.http(name, {
    methods: ['GET'],
    authLevel: 'anonymous',
    route,
    handler: async (request, context) => {
      try {
        return { status: 200, jsonBody: { [key]: await list() } };
      } catch (err) {
        context.error(`Listing ${key} failed.`, err);
        return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load the options, please try again later' } };
      }
    },
  });
}

listOptions('listSpecializations', 'specializations', 'specializations', listActiveSpecializations);
listOptions('listAccreditations', 'accreditations', 'accreditations', listActiveAccreditations);
