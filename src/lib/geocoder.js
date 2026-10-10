'use strict';

// Looks up the coordinates of a Dutch postal code in the PDOK Locatieserver: the free geocoder of the Dutch government, no API key.
const PDOK_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const POSTAL_CODE = /^[1-9]\d{3}[A-Z]{2}$/;
const TIMEOUT_MS = 3000;

// centroide_ll is WKT with longitude first: "POINT(5.12345678 52.09876543)".
const POINT = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/;

/**
 * Returns { latitude, longitude } (6 decimals) of a postal code such as "3511AB", or null when PDOK does not know it.
 * Throws when PDOK cannot be reached or answers with an error, so callers can tell "unknown" from "try again later".
 */
async function geocodePostalCode(postalCode, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!POSTAL_CODE.test(postalCode)) return null;

  const query = new URLSearchParams({ q: `postcode:${postalCode}`, fq: 'type:postcode', fl: 'centroide_ll', rows: '1' });
  const response = await fetchImpl(`${PDOK_URL}?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`PDOK Locatieserver answered ${response.status}`);

  const match = POINT.exec((await response.json())?.response?.docs?.[0]?.centroide_ll ?? '');
  if (!match) return null;
  return { latitude: Number(Number(match[2]).toFixed(6)), longitude: Number(Number(match[1]).toFixed(6)) };
}

/**
 * Best effort for the places where a user is waiting: a failed lookup is logged and answered with null, because a registration or a
 * repair request must never fail over a distance. The row is stored without coordinates and scripts/geocode-backfill.js fills it in.
 */
async function tryGeocode(postalCode, context, options) {
  try {
    return await geocodePostalCode(postalCode, options);
  } catch (err) {
    context?.warn(`Looking up the coordinates of ${postalCode} failed; storing it without.`, err);
    return null;
  }
}

module.exports = { geocodePostalCode, tryGeocode };
