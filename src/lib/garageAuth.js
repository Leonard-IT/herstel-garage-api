'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

const unauthorized = { status: 401, jsonBody: { error: 'unauthorized', message: 'Sign in to continue' } };
const forbidden = { status: 403, jsonBody: { error: 'forbidden', message: 'Your account is not linked to an approved garage' } };

const OBJECT_ID_CLAIMS = ['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier'];

// Local development only: lets you call the endpoints without a real login by sending x-dev-user-id.
// It is refused inside Azure (WEBSITE_SITE_NAME is always set there), whatever the settings say.
const devAuthAllowed = (env = process.env) => env.ALLOW_DEV_AUTH === 'true' && !env.WEBSITE_SITE_NAME;

/** The user's object id (the "oid" claim) from the claims App Service Authentication puts in x-ms-client-principal. */
function objectIdFromPrincipal(headers) {
  const raw = headers.get('x-ms-client-principal');
  if (!raw) return null;
  try {
    const principal = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return principal.claims?.find((claim) => OBJECT_ID_CLAIMS.includes(claim.typ))?.val ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the signed-in user's id, matching GarageUsers.ExternalId. In Azure, App Service Authentication validates the
 * bearer token and sets the x-ms-client-principal* headers (it strips any value sent by the client). The "oid" claim is
 * preferred; x-ms-client-principal-id is only a fallback, because it is not guaranteed to hold the object id.
 */
function getCallerId(headers, env = process.env) {
  const id = objectIdFromPrincipal(headers)
    || headers.get('x-ms-client-principal-id')
    || (devAuthAllowed(env) ? headers.get('x-dev-user-id') : null);
  return id && /^[\w-]{1,100}$/.test(id) ? id : null;
}

// Enough to compare with a known id without writing the full user id to the logs.
const mask = (id) => (id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id);

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
    .query(`SELECT g.Id, g.Status FROM dbo.GarageUsers u JOIN dbo.Garages g ON g.Id = u.GarageId
            WHERE u.ExternalId = @externalId`);
  const garage = result.recordset[0];
  if (!garage || garage.Status !== 'approved') {
    context?.warn(garage
      ? `Request refused (403): user ${mask(callerId)} is linked to a garage with status '${garage.Status}'`
      : `Request refused (403): no GarageUsers row with ExternalId ${mask(callerId)}`);
    return { response: forbidden };
  }
  return { garageId: garage.Id };
}

module.exports = { getCallerId, requireGarage, devAuthAllowed };
