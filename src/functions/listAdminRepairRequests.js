'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { listOpenRequests } = require('../lib/garageRequestRepository');
const { presentRequestList } = require('../lib/requestListView');

// The requests a link can be made for: the same open requests the garages see, but not from the point of view of one garage.
app.http('listAdminRepairRequests', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/repair-requests',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;

      return { status: 200, jsonBody: await presentRequestList(await listOpenRequests(null)) };
    } catch (err) {
      context.error('Listing repair requests for an administrator failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load requests, please try again later' } };
    }
  },
});
