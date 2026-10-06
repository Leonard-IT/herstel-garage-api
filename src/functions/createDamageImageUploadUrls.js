'use strict';

const { app } = require('@azure/functions');
const { validateUploadUrlRequest } = require('../lib/repairValidation');
const { createUploadUrls } = require('../lib/blobStorage');

app.http('createDamageImageUploadUrls', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'damage-reports/upload-urls',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json', message: 'Request body must be valid JSON' } };
    }

    const { value, errors } = validateUploadUrlRequest(body);
    if (errors) {
      return { status: 422, jsonBody: { error: 'validation_failed', message: 'Validation failed', details: errors } };
    }

    try {
      return { status: 200, jsonBody: { uploads: await createUploadUrls(value.files) } };
    } catch (err) {
      context.error('Creating upload URLs failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not create upload links, please try again later' } };
    }
  },
});
