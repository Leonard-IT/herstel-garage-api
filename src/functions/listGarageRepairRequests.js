'use strict';

const { app } = require('@azure/functions');
const { requireGarage } = require('../lib/garageAuth');
const { listOpenRequests } = require('../lib/garageRequestRepository');
const { presentRequestList } = require('../lib/requestListView');

app.http('listGarageRepairRequests', {
  methods: ['GET'],
  authLevel: 'anonymous', // the caller is authenticated by App Service Authentication and checked in requireGarage
  route: 'garage/repair-requests',
  handler: async (request, context) => {
    try {
      const { response, garageId } = await requireGarage(request, context);
      if (response) return response;

      return { status: 200, jsonBody: await presentRequestList(await listOpenRequests(garageId)) };
    } catch (err) {
      context.error('Listing repair requests failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load requests, please try again later' } };
    }
  },
});
