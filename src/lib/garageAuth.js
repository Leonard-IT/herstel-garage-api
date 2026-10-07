'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

const unauthorized = { status: 401, jsonBody: { error: 'unauthorized', message: 'Sign in to continue' } };
const forbidden = { status: 403, jsonBody: { error: 'forbidden', message: 'Your account is not linked to an approved garage' } };

// Local development only: lets you call the endpoints without a real login by sending x-dev-user-id.
// It is refused inside Azure (WEBSITE_SITE_NAME is always set there), whatever the settings say.
const devAuthAllowed = (env = process.env) => env.ALLOW_DEV_AUTH === 'true' && !env.WEBSITE_SITE_NAME;

/**
 * Returns the signed-in user's id. In Azure, App Service Authentication validates the bearer token and sets
 * x-ms-client-principal-id (it strips any value sent by the client).
 */
function getCallerId(headers, env = process.env) {
  const id = headers.get('x-ms-client-principal-id') || (devAuthAllowed(env) ? headers.get('x-dev-user-id') : null);
  return id && /^[\w-]{1,100}$/.test(id) ? id : null;
}

/**
 * Resolves the request to an approved garage.
 * Returns { garageId } or { response } with the 401/403 to send back.
 */
async function requireGarage(request, context) {
  const callerId = getCallerId(request.headers);
  if (!callerId) {
    // Diagnostic for misconfigured authentication: header names only, never values or the token itself.
    const names = [...request.headers.keys()].filter((name) => name.startsWith('x-ms-client-principal') || name.startsWith('x-ms-token'));
    context?.warn(`Request refused (401): Authorization header ${request.headers.has('authorization') ? 'present' : 'missing'}, `
      + `App Service authentication headers: ${names.length ? names.join(', ') : 'none'}`);
    return { response: unauthorized };
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('externalId', sql.VarChar(100), callerId)
    .query(`SELECT g.Id FROM dbo.GarageUsers u JOIN dbo.Garages g ON g.Id = u.GarageId
            WHERE u.ExternalId = @externalId AND g.Status = 'approved'`);
  if (!result.recordset.length) return { response: forbidden };
  return { garageId: result.recordset[0].Id };
}

module.exports = { getCallerId, requireGarage, devAuthAllowed };
