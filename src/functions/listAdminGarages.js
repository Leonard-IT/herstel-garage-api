'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { listApprovedGarages } = require('../lib/shareLinkRepository');

// The garages a link can be made for: the ones that exist in the platform and are approved.
app.http('listAdminGarages', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'backoffice/garages',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;

      return { status: 200, jsonBody: { garages: await listApprovedGarages() } };
    } catch (err) {
      context.error('Listing garages failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load garages, please try again later' } };
    }
  },
});
