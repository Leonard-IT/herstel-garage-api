'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { revokeLink } = require('../lib/shareLinkRepository');
const { GUID } = require('../lib/shareValidation');

// DELETE /api/backoffice/share-links/{id}: the link stops working at once (it stays in the list, marked as revoked).
app.http('revokeShareLink', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'backoffice/share-links/{id}',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;

      const { id } = request.params;
      if (!GUID.test(id) || !(await revokeLink(id))) {
        return { status: 404, jsonBody: { error: 'not_found', message: 'Link not found' } };
      }
      return { status: 204 };
    } catch (err) {
      context.error('Revoking a share link failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not revoke the link, please try again later' } };
    }
  },
});
