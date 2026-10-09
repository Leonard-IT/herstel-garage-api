'use strict';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_EXPIRES_IN_DAYS = 7;
const MAX_EXPIRES_IN_DAYS = 90;
/** At most this many garages in one go, so one click cannot create hundreds of links by accident. */
const MAX_GARAGES_PER_REQUEST = 50;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates "create links": { repairRequestId, garageIds: [guid, ...], expiresInDays? }.
 * Returns { value } or { errors: { field: message } }. Whether the request and the garages exist is checked by the caller.
 */
function validateCreateLinks(body) {
  if (!isObject(body)) return { errors: { body: 'Request body must be a JSON object' } };
  const errors = {};

  const repairRequestId = typeof body.repairRequestId === 'string' ? body.repairRequestId.trim().toLowerCase() : '';
  if (!GUID.test(repairRequestId)) errors.repairRequestId = 'Must be the id of a repair request';

  let garageIds = [];
  if (!Array.isArray(body.garageIds) || body.garageIds.length === 0) {
    errors.garageIds = 'Choose at least one garage';
  } else if (body.garageIds.some((id) => typeof id !== 'string' || !GUID.test(id.trim()))) {
    errors.garageIds = 'Must be a list of garage ids';
  } else {
    garageIds = [...new Set(body.garageIds.map((id) => id.trim().toLowerCase()))];
    if (garageIds.length > MAX_GARAGES_PER_REQUEST) {
      errors.garageIds = `At most ${MAX_GARAGES_PER_REQUEST} garages at a time`;
    }
  }

  let expiresInDays = DEFAULT_EXPIRES_IN_DAYS;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    expiresInDays = body.expiresInDays;
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRES_IN_DAYS) {
      errors.expiresInDays = `Must be a whole number of days from 1 to ${MAX_EXPIRES_IN_DAYS}`;
    }
  }

  if (Object.keys(errors).length) return { errors };
  return { value: { repairRequestId, garageIds, expiresInDays } };
}

module.exports = { validateCreateLinks, GUID, DEFAULT_EXPIRES_IN_DAYS, MAX_EXPIRES_IN_DAYS, MAX_GARAGES_PER_REQUEST };
