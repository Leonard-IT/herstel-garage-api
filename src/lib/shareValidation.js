'use strict';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_EXPIRES_IN_DAYS = 7;
const MAX_EXPIRES_IN_DAYS = 90;
/** At most this many garages in one go, so one click cannot create hundreds of links by accident. */
const MAX_GARAGES_PER_REQUEST = 50;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** A list of ids, or an error message. Missing means an empty list. */
function idList(raw, what) {
  if (raw === undefined || raw === null) return { ids: [] };
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || !GUID.test(id.trim()))) {
    return { error: `Must be a list of ${what} ids` };
  }
  return { ids: [...new Set(raw.map((id) => id.trim().toLowerCase()))] };
}

/**
 * Validates "create links": { repairRequestId, garageIds?: [guid, ...], prospectIds?: [guid, ...], expiresInDays? }. Links can go to
 * garages in the network and to prospects (garages we reach out to), together at least one and at most MAX_GARAGES_PER_REQUEST.
 * Returns { value } or { errors: { field: message } }. Whether the request, the garages and the prospects exist is checked by the caller.
 */
function validateCreateLinks(body) {
  if (!isObject(body)) return { errors: { body: 'Request body must be a JSON object' } };
  const errors = {};

  const repairRequestId = typeof body.repairRequestId === 'string' ? body.repairRequestId.trim().toLowerCase() : '';
  if (!GUID.test(repairRequestId)) errors.repairRequestId = 'Must be the id of a repair request';

  const garages = idList(body.garageIds, 'garage');
  const prospects = idList(body.prospectIds, 'prospect');
  if (garages.error) errors.garageIds = garages.error;
  if (prospects.error) errors.prospectIds = prospects.error;
  const garageIds = garages.ids ?? [];
  const prospectIds = prospects.ids ?? [];
  if (!garages.error && !prospects.error) {
    const total = garageIds.length + prospectIds.length;
    if (total === 0) errors.garageIds = 'Choose at least one garage or prospect';
    else if (total > MAX_GARAGES_PER_REQUEST) errors.garageIds = `At most ${MAX_GARAGES_PER_REQUEST} garages at a time`;
  }

  let expiresInDays = DEFAULT_EXPIRES_IN_DAYS;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    expiresInDays = body.expiresInDays;
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRES_IN_DAYS) {
      errors.expiresInDays = `Must be a whole number of days from 1 to ${MAX_EXPIRES_IN_DAYS}`;
    }
  }

  if (Object.keys(errors).length) return { errors };
  return { value: { repairRequestId, garageIds, prospectIds, expiresInDays } };
}

module.exports = { validateCreateLinks, GUID, DEFAULT_EXPIRES_IN_DAYS, MAX_EXPIRES_IN_DAYS, MAX_GARAGES_PER_REQUEST };
