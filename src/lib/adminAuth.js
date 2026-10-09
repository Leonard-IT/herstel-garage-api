'use strict';

const { getCallerId } = require('./garageAuth');

const unauthorized = { status: 401, jsonBody: { error: 'unauthorized', message: 'Sign in to continue' } };
const forbidden = { status: 403, jsonBody: { error: 'forbidden', message: 'This is only available to platform administrators' } };

/**
 * The ids (Entra object ids) of the platform administrators: the app setting ADMIN_USER_IDS, comma separated.
 * Empty or missing means nobody is an administrator, so these endpoints stay closed until it is set.
 *
 * This is a stopgap until the admin site exists (with its own sign-in through the company tenant): an administrator is simply
 * someone whose login is on this list. It does not depend on being linked to a garage.
 */
function adminIds(env = process.env) {
  return (env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

const isAdminId = (id, env = process.env) => Boolean(id) && adminIds(env).includes(String(id).toLowerCase());

/** Resolves the request to a platform administrator. Returns { adminId } or { response } with the 401/403 to send back. */
function requireAdmin(request, context) {
  const callerId = getCallerId(request.headers);
  if (!callerId) return { response: unauthorized };
  if (!isAdminId(callerId)) {
    context?.warn(`Request refused (403): user ${callerId.slice(0, 8)}... is not a platform administrator`);
    return { response: forbidden };
  }
  return { adminId: callerId };
}

module.exports = { requireAdmin, isAdminId, adminIds };
