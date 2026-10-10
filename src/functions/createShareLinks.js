'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { validateCreateLinks } = require('../lib/shareValidation');
const { createLinks } = require('../lib/shareLinkRepository');
const { shareUrl } = require('../lib/shareToken');

/**
 * POST /api/backoffice/share-links { repairRequestId, garageIds?: [...], prospectIds?: [...], expiresInDays? }: one link per garage in the
 * network and per prospect, to the public page of the request. A recipient that already has a running link for this request gets that
 * one back (existing: true) instead of a second one.
 */
app.http('createShareLinks', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'backoffice/share-links',
  handler: async (request, context) => {
    try {
      const { response, adminId } = requireAdmin(request, context);
      if (response) return response;

      let body;
      try {
        body = await request.json();
      } catch {
        return { status: 400, jsonBody: { error: 'invalid_json', message: 'Request body must be valid JSON' } };
      }

      const { value, errors } = validateCreateLinks(body);
      if (errors) {
        return { status: 422, jsonBody: { error: 'validation_failed', message: 'Validation failed', details: errors } };
      }

      const result = await createLinks({ ...value, createdBy: adminId });
      if (result.notFound) {
        return { status: 404, jsonBody: { error: 'not_found', message: 'Repair request not found or no longer open' } };
      }
      if (result.unknownGarageIds || result.unknownProspectIds) {
        const details = {};
        if (result.unknownGarageIds?.length) details.garageIds = `Unknown or not approved garages: ${result.unknownGarageIds.join(', ')}`;
        if (result.unknownProspectIds?.length) {
          details.prospectIds = `Unknown prospects, or prospects that signed up already: ${result.unknownProspectIds.join(', ')}`;
        }
        return { status: 422, jsonBody: { error: 'validation_failed', message: 'Validation failed', details } };
      }

      context.log(`Share links for request ${value.repairRequestId}: ${result.links.length} (${result.links.filter((l) => l.existing).length} existing)`);
      return {
        status: 201,
        jsonBody: {
          links: result.links.map(({ token, ...link }) => ({ ...link, url: shareUrl(token) })),
        },
      };
    } catch (err) {
      context.error('Creating share links failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not create the links, please try again later' } };
    }
  },
});
