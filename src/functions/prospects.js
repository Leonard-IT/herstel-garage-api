'use strict';

const { app } = require('@azure/functions');
const { requireAdmin } = require('../lib/adminAuth');
const { listProspects, createProspect } = require('../lib/prospectRepository');
const { validateProspect } = require('../lib/prospectValidation');

/** GET /api/backoffice/prospects: all garage prospects (garages we want to reach out to), with their status and number of links. */
app.http('listProspects', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'backoffice/prospects',
  handler: async (request, context) => {
    try {
      const { response } = requireAdmin(request, context);
      if (response) return response;
      return { status: 200, jsonBody: { prospects: await listProspects() } };
    } catch (err) {
      context.error('Listing prospects failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not load the prospects, please try again later' } };
    }
  },
});

/** POST /api/backoffice/prospects: adds a prospect. 201 with the prospect; 409 when another prospect has the same KvK number. */
app.http('createProspect', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'backoffice/prospects',
  handler: async (request, context) => {
    try {
      const { response, adminId } = requireAdmin(request, context);
      if (response) return response;

      let body;
      try {
        body = await request.json();
      } catch {
        return { status: 400, jsonBody: { error: 'invalid_json', message: 'Request body must be valid JSON' } };
      }
      const { value, errors } = validateProspect(body);
      if (errors) return { status: 422, jsonBody: { error: 'validation_failed', message: 'Validation failed', details: errors } };

      try {
        return { status: 201, jsonBody: await createProspect(value, adminId) };
      } catch (err) {
        if (err.statusCode === 409) {
          return { status: 409, jsonBody: { error: 'already_exists', message: 'A prospect with this KvK number already exists' } };
        }
        throw err;
      }
    } catch (err) {
      context.error('Adding a prospect failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Could not add the prospect, please try again later' } };
    }
  },
});
