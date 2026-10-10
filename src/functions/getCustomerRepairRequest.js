'use strict';

const { app } = require('@azure/functions');
const { getCustomerRequest } = require('../lib/customerRequestRepository');
const { presentCustomerView } = require('../lib/customerView');
const { createReadUrls } = require('../lib/blobStorage');
const { isValidToken } = require('../lib/shareToken');

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const notFound = { status: 404, headers: NO_STORE, jsonBody: { error: 'not_found', message: 'Request not found' } };

/**
 * The customer's view of their own request, for mijn-aanvraag.html: the request, the offer they can accept or decline, and what happens
 * next. The token from the customer's link is the only key; there is no login.
 */
async function loadView(token) {
  const record = await getCustomerRequest(token);
  if (!record) return null;
  return presentCustomerView(record, await createReadUrls(record.imagePaths));
}

app.http('getCustomerRepairRequest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'customer/repair-requests/{token}',
  handler: async (request, context) => {
    try {
      const { token } = request.params;
      if (!isValidToken(token)) return notFound;
      const view = await loadView(token);
      if (!view) return notFound;
      return { status: 200, headers: NO_STORE, jsonBody: view };
    } catch (err) {
      context.error('Loading a customer request failed.', err);
      return { status: 500, headers: NO_STORE, jsonBody: { error: 'internal_error', message: 'Could not load your request, please try again later' } };
    }
  },
});

module.exports = { loadView, NO_STORE };
