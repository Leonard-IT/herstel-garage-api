'use strict';

const { app } = require('@azure/functions');
const { isAdminId } = require('../lib/adminAuth');
const { getCallerId } = require('../lib/garageAuth');

// Lets the dashboard find out whether to show the administrator pages. Any signed-in user gets an answer (isAdmin true or false), so
// that normal garage users do not see a failing request on every page; only a caller without a login gets 401.
app.http('adminMe', {
  methods: ['GET'],
  authLevel: 'anonymous', // the caller is authenticated by App Service Authentication
  route: 'backoffice/me',
  handler: async (request) => {
    const callerId = getCallerId(request.headers);
    if (!callerId) return { status: 401, jsonBody: { error: 'unauthorized', message: 'Sign in to continue' } };
    return { status: 200, jsonBody: { isAdmin: isAdminId(callerId) } };
  },
});
