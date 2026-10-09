'use strict';

const { app } = require('@azure/functions');
const { getPublicView } = require('../lib/shareLinkRepository');
const { DISPLAYABLE_IMAGE_TYPES } = require('../lib/sharePage');
const { readImage } = require('../lib/blobStorage');
const { isValidToken } = require('../lib/shareToken');

const notFound = { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } };

/**
 * GET /api/s/{token}/photo/{n}: photo number n (1-based) of the request behind a share link, served through the API.
 *
 * A short-lived storage link would not do for the link preview: chat apps keep the preview (and its photo address) for a long time, so
 * the address has to keep working. This one works for as long as the share link does.
 */
app.http('getSharedRequestPhoto', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 's/{token}/photo/{n}',
  handler: async (request, context) => {
    try {
      const { token } = request.params;
      const n = Number(request.params.n);
      if (!isValidToken(token) || !Number.isInteger(n) || n < 1 || n > 50) return notFound;

      const view = await getPublicView(token);
      const image = view?.images[n - 1];
      if (!image || !DISPLAYABLE_IMAGE_TYPES.includes(image.contentType)) return notFound;

      const data = await readImage(image.blobPath);
      if (!data) return notFound;

      return {
        status: 200,
        body: data,
        headers: {
          'Content-Type': image.contentType,
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
        },
      };
    } catch (err) {
      context.error('Serving a shared photo failed.', err);
      return { status: 500 };
    }
  },
});
