'use strict';

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

const isPoint = (p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude);

/** Great-circle distance in kilometres between two { latitude, longitude } points (Haversine). */
function haversineKm(from, to) {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The distance a garage is shown: as the crow flies, in whole kilometres, or null when either point is unknown.
 * Whole kilometres on purpose: the points are postal code centroids, so more precision would be false, and a garage that
 * knows its own address should not be able to pin down the customer's address from the number.
 * Real roads are roughly 20-25% longer than this; the client labels it as "hemelsbreed".
 */
function roughDistanceKm(from, to) {
  if (!isPoint(from) || !isPoint(to)) return null;
  return Math.round(haversineKm(from, to));
}

module.exports = { haversineKm, roughDistanceKm };
