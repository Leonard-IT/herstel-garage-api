'use strict';

/** How long an offer stays valid after it is made, in hours. Must match the CHECK constraint in migration 005. */
const VALIDITY_HOURS = [12, 24, 48];
/** How far ahead a garage can say it is available. */
const MAX_DAYS_AHEAD = 365;

const TIME_ZONE = 'Europe/Amsterdam';
// en-CA formats dates as yyyy-mm-dd.
const dayInAmsterdam = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Today's date in the Netherlands as yyyy-mm-dd. The server runs in UTC, so "today" must not come from the server's own clock. */
function todayInNetherlands(now = new Date()) {
  return dayInAmsterdam.format(now);
}

/** True for a real calendar date written as yyyy-mm-dd (so not 2026-02-30). */
function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Validates an offer: { availableFrom: 'yyyy-mm-dd', validityHours: 12 | 24 | 48 }.
 * Returns { value } on success or { errors: { field: message } } on failure.
 */
function validateOffer(body, now = new Date()) {
  if (!isObject(body)) return { errors: { body: 'Request body must be a JSON object' } };
  const errors = {};

  const availableFrom = body.availableFrom;
  if (!isCalendarDate(availableFrom)) {
    errors.availableFrom = 'Must be a date written as yyyy-mm-dd';
  } else {
    const today = todayInNetherlands(now);
    const limit = todayInNetherlands(new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000));
    if (availableFrom < today) errors.availableFrom = 'Must not be in the past';
    else if (availableFrom > limit) errors.availableFrom = `Must be within ${MAX_DAYS_AHEAD} days from today`;
  }

  const validityHours = body.validityHours;
  if (!VALIDITY_HOURS.includes(validityHours)) {
    errors.validityHours = `Must be one of: ${VALIDITY_HOURS.join(', ')}`;
  }

  if (Object.keys(errors).length) return { errors };
  return { value: { availableFrom, validityHours } };
}

module.exports = { validateOffer, todayInNetherlands, isCalendarDate, VALIDITY_HOURS, MAX_DAYS_AHEAD };
