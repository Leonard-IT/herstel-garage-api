'use strict';

const { app } = require('@azure/functions');
const { getPublicView, recordView } = require('../lib/shareLinkRepository');
const { renderSharePage, renderGonePage } = require('../lib/sharePage');
const { isValidToken, isPreviewBot, shareBaseUrl, dashboardUrl } = require('../lib/shareToken');

// The page only loads its own photos and has no scripts. It must not be indexed, and must not pass the link on in a Referer header.
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/**
 * GET /api/s/{token}: the public page of a share link (no login). Chat apps fetch it to build the link preview, so it is plain HTML
 * with Open Graph tags. A person opening it counts as an open; a link previewer does not (see recordView).
 */
app.http('viewSharedRequest', {
  methods: ['GET', 'HEAD'],
  authLevel: 'anonymous',
  route: 's/{token}',
  handler: async (request, context) => {
    const gone = () => ({ status: 404, headers: HEADERS, body: renderGonePage({ dashboardUrl: dashboardUrl() }) });
    try {
      const { token } = request.params;
      if (!isValidToken(token)) return gone();

      const view = await getPublicView(token);
      if (!view) return gone();

      // Not counted: HEAD requests, and "?nc=1", which the admin page adds to its own "open" button so testing a link does not
      // show up as the garage having opened it.
      const countable = request.method === 'GET' && request.query.get('nc') !== '1';
      if (countable) {
        try {
          await recordView(view.linkId, { preview: isPreviewBot(request.headers.get('user-agent')) });
        } catch (err) {
          context.error('Recording a view of a share link failed.', err); // never let this break the page
        }
      }

      return {
        status: 200,
        headers: HEADERS,
        body: renderSharePage(view, { token, baseUrl: shareBaseUrl(), noCount: request.query.get('nc') === '1' }),
      };
    } catch (err) {
      context.error('Showing a shared request failed.', err);
      return { status: 500, headers: HEADERS, body: renderGonePage({ dashboardUrl: dashboardUrl() }) };
    }
  },
});
