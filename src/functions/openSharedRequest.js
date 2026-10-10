'use strict';

const { app } = require('@azure/functions');
const { getPublicView, recordClick } = require('../lib/shareLinkRepository');
const { renderGonePage } = require('../lib/sharePage');
const { isValidToken, isPreviewBot, dashboardUrl, clickTarget } = require('../lib/shareToken');

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * GET /api/s/{token}/open: the button on the public page. Counts the click (the "Op volledige aanvraag geklikt" step of the onboarding
 * funnel) and sends the visitor on at once: a garage in the network to the request in the dashboard, a prospect to the sign-up form.
 * Counted like the opens: people only, not link previewers, not HEAD requests and not the admin's own test (?nc=1).
 */
app.http('openSharedRequest', {
  methods: ['GET', 'HEAD'],
  authLevel: 'anonymous',
  route: 's/{token}/open',
  handler: async (request, context) => {
    const gone = () => ({
      status: 404,
      headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' },
      body: renderGonePage({ dashboardUrl: dashboardUrl() }),
    });
    try {
      const { token } = request.params;
      if (!isValidToken(token)) return gone();
      const view = await getPublicView(token);
      if (!view) return gone();

      const countable = request.method === 'GET' && request.query.get('nc') !== '1' && !isPreviewBot(request.headers.get('user-agent'));
      if (countable) {
        try {
          await recordClick(view.linkId);
        } catch (err) {
          context.error('Recording a click on a share link failed.', err); // never let this stop the visitor
        }
      }
      return { status: 302, headers: { ...NO_STORE, Location: clickTarget(view, token) } };
    } catch (err) {
      context.error('Following a share link failed.', err);
      return { status: 500, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' }, body: renderGonePage({ dashboardUrl: dashboardUrl() }) };
    }
  },
});
