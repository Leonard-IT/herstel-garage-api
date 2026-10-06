'use strict';

const { app } = require('@azure/functions');
const { listActivePreferences } = require('../lib/repairRequestRepository');

app.http('listRepairPreferences', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'repair-preferences',
  handler: async (request, context) => {
    try {
      return { status: 200, jsonBody: { preferences: await listActivePreferences() } };
    } catch (err) {
      context.error('Listing repair preferences failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load preferences, please try again later' } };
    }
  },
});
