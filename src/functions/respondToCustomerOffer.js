'use strict';

const { app } = require('@azure/functions');
const { respondToOffer } = require('../lib/customerRequestRepository');
const { isValidToken } = require('../lib/shareToken');
const { GUID } = require('../lib/shareValidation');
const { loadView, NO_STORE } = require('./getCustomerRepairRequest');

// Status and message per reason an answer is not possible. The page shows its own Dutch text per error code.
const ERRORS = {
  not_found: [404, 'Request or offer not found'],
  request_closed: [409, 'This request is no longer open'],
  offer_expired: [409, 'This offer has expired'],
  offer_closed: [409, 'This offer can no longer be answered'],
};

/**
 * POST /api/customer/repair-requests/{token}/offers/{offerId}/accept and .../decline: the customer answers an offer. On success the
 * response is the customer's view after the answer, the same as GET /api/customer/repair-requests/{token}, so the page can show it
 * straight away.
 */
function register(name, action) {
  app.http(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: `customer/repair-requests/{token}/offers/{offerId}/${action}`,
    handler: async (request, context) => {
      try {
        const { token, offerId } = request.params;
        if (!isValidToken(token) || !GUID.test(offerId)) {
          return { status: 404, headers: NO_STORE, jsonBody: { error: 'not_found', message: ERRORS.not_found[1] } };
        }

        const result = await respondToOffer({ token, offerId: offerId.toLowerCase(), action });
        if (result.error) {
          const [status, message] = ERRORS[result.error];
          return { status, headers: NO_STORE, jsonBody: { error: result.error, message } };
        }
        context.log(`Customer ${action === 'accept' ? 'accepted' : 'declined'} offer ${offerId}`);
        return { status: 200, headers: NO_STORE, jsonBody: await loadView(token) };
      } catch (err) {
        context.error(`Answering an offer (${action}) failed.`, err);
        return { status: 500, headers: NO_STORE, jsonBody: { error: 'internal_error', message: 'Could not save your answer, please try again later' } };
      }
    },
  });
}

register('acceptCustomerOffer', 'accept');
register('declineCustomerOffer', 'decline');
