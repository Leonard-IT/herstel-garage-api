'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { listInvites } = require('../lib/onboardingRepository');

/**
 * GET /api/backoffice/onboarding: the invites of the onboarding funnel (share links to prospects and to garages that came from one), each
 * with a timestamp per step. The dashboard works out the funnel, waiting times and "stuck" from these (src/features/onboarding there).
 */
app.http('getOnboarding', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'backoffice/onboarding',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;
      return { status: 200, jsonBody: { invites: await listInvites() } };
    } catch (err) {
      context.error('Loading the onboarding funnel failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load the onboarding funnel, please try again later' } };
    }
  },
});
