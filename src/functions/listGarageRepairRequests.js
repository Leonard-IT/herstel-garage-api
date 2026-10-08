'use strict';

const { app } = require('@azure/functions');
const { requireGarage } = require('../lib/garageAuth');
const { listOpenRequests } = require('../lib/garageRequestRepository');
const { createReadUrls } = require('../lib/blobStorage');

app.http('listGarageRepairRequests', {
  methods: ['GET'],
  authLevel: 'anonymous', // the caller is authenticated by App Service Authentication and checked in requireGarage
  route: 'garage/repair-requests',
  handler: async (request, context) => {
    try {
      const { response } = await requireGarage(request, context);
      if (response) return response;

      const requests = await listOpenRequests();
      const urls = await createReadUrls(requests.flatMap((r) => r.thumbnailPaths));
      return {
        status: 200,
        jsonBody: {
          repairRequests: requests.map(({ thumbnailPaths, damageReportId, ...rest }) => {
            const thumbnailUrls = thumbnailPaths.map((path) => urls.get(path));
            // thumbnailUrl (first photo) is kept for older clients; thumbnailUrls holds up to two photos for the card.
            return { ...rest, thumbnailUrl: thumbnailUrls[0] ?? null, thumbnailUrls };
          }),
        },
      };
    } catch (err) {
      context.error('Listing repair requests failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load requests, please try again later' } };
    }
  },
});
