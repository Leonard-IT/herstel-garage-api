'use strict';

const { app } = require('@azure/functions');
const { getCallerId, requireGarage } = require('../lib/garageAuth');
const { isAdminId } = require('../lib/adminAuth');
const { getOpenRequest } = require('../lib/garageRequestRepository');
const { createReadUrls } = require('../lib/blobStorage');
const { recordView } = require('../lib/repairRequestViewRepository');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.http('getGarageRepairRequest', {
  methods: ['GET'],
  authLevel: 'anonymous', // the caller is authenticated by App Service Authentication and checked in requireGarage
  route: 'garage/repair-requests/{id}',
  handler: async (request, context) => {
    try {
      const { response, garageId, userId } = await requireGarage(request, context);
      if (response) return response;

      const notFound = { status: 404, jsonBody: { error: 'not_found', message: 'Repair request not found' } };
      const { id } = request.params;
      if (!GUID.test(id)) return notFound;

      // Opening the detail page is a view. Recorded before loading, so the count in this response includes it. A failure here must not
      // cost the garage the page: it is logged and the request is shown anyway. Platform administrators (ADMIN_USER_IDS) are not
      // counted: the team looking at requests says nothing about the interest of garages.
      if (!isAdminId(getCallerId(request.headers))) {
        try {
          await recordView({ repairRequestId: id, garageUserId: userId });
        } catch (err) {
          context.warn(`Recording a view of ${id} failed; showing the request anyway.`, err);
        }
      }

      const found = await getOpenRequest(id, garageId);
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
