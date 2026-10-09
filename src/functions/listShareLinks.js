'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { listLinks } = require('../lib/shareLinkRepository');
const { shareUrl } = require('../lib/shareToken');

/**
 * GET /api/admin/share-links: the newest links with whether and when they were opened, and the totals for the top of the page
 * (links made, opened, open rate, average time until the first open).
 */
app.http('listShareLinks', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/share-links',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;

      const { stats, links } = await listLinks();
      return { status: 200, jsonBody: { stats, links: links.map(({ token, ...link }) => ({ ...link, url: shareUrl(token) })) } };
    } catch (err) {
      context.error('Listing share links failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load the links, please try again later' } };
    }
  },
});
