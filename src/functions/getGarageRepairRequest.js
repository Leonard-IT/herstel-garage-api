'use strict';

const { app } = require('@azure/functions');
const { requireGarage } = require('../lib/garageAuth');
const { getOpenRequest } = require('../lib/garageRequestRepository');
const { createReadUrls } = require('../lib/blobStorage');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.http('getGarageRepairRequest', {
  methods: ['GET'],
  authLevel: 'anonymous', // the caller is authenticated by App Service Authentication and checked in requireGarage
  route: 'garage/repair-requests/{id}',
  handler: async (request, context) => {
    try {
      const { response } = await requireGarage(request, context);
      if (response) return response;

      const notFound = { status: 404, jsonBody: { error: 'not_found', message: 'Repair request not found' } };
      const { id } = request.params;
      if (!GUID.test(id)) return notFound;
      const found = await getOpenRequest(id);
      if (!found) return notFound;

      const urls = await createReadUrls(found.imagePaths);
      const { imagePaths, damageReportId, ...rest } = found;
      return { status: 200, jsonBody: { ...rest, images: imagePaths.map((path) => ({ url: urls.get(path) })) } };
    } catch (err) {
      context.error('Loading repair request failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load the request, please try again later' } };
    }
  },
});
