'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { ensureCustomerToken } = require('../lib/customerRequestRepository');
const { customerPageUrl } = require('../lib/customerLink');
const { GUID } = require('../lib/shareValidation');

/**
 * POST /api/backoffice/repair-requests/{id}/customer-link: the link to the customer's own page for a request, for the team to send to the
 * customer (there is no email yet). Always the same link for a request; requests from before the customer page get theirs now.
 */
app.http('createCustomerLink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'backoffice/repair-requests/{id}/customer-link',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;

      const { id } = request.params;
      const token = GUID.test(id) ? await ensureCustomerToken(id) : null;
      if (!token) return { status: 404, jsonBody: { error: 'not_found', message: 'Request not found' } };
      return { status: 200, jsonBody: { customerUrl: customerPageUrl(token) } };
    } catch (err) {
      context.error('Making a customer link failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not make the link, please try again later' } };
    }
  },
});
