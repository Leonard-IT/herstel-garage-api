'use strict';

const { customerStage, buildNextSteps } = require('./customerNextSteps');

const formatPostalCode = (code) => (code && code.length === 6 ? `${code.slice(0, 4)} ${code.slice(4)}` : code);

const garageAddress = (garage) => `${garage.street}, ${formatPostalCode(garage.postalCode)} ${garage.city}`;

/**
 * The offers the customer gets to see: the one that is running (they can accept or decline it) and the one they accepted. Expired,
 * declined and withdrawn offers are history the customer cannot do anything with, so they are left out.
 *
 * The garage's phone number and email address are only shown once the customer accepted its offer; before that the customer sees who
 * the garage is and where it is.
 */
function presentOffers(offers, now) {
  return offers
    .filter((offer) => offer.status === 'accepted' || (offer.status === 'active' && offer.expiresAt > now))
    .map((offer) => {
      const accepted = offer.status === 'accepted';
      return {
        id: offer.id,
        status: offer.status,
        availableFrom: offer.availableFrom,
        expiresAt: offer.expiresAt.toISOString(),
        createdAt: offer.createdAt.toISOString(),
        respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
        canRespond: !accepted,
        garage: {
          companyName: offer.garage.companyName,
          city: offer.garage.city,
          address: garageAddress(offer.garage),
          website: offer.garage.website || null,
          accreditations: offer.garage.accreditations,
          phone: accepted ? offer.garage.phone : null,
          email: accepted ? offer.garage.email : null,
        },
      };
    });
}

/**
 * What the customer page gets: the request (it is the customer's own, so it includes their license plate and description), the offers
 * they can act on, and the explanation of where they stand and what is expected of them.
 * imageUrls: Map(blobPath -> short-lived read URL).
 */
function presentCustomerView(record, imageUrls, now = new Date()) {
  const offers = presentOffers(record.offers, now);
  const stage = customerStage(record.status, record.offers.map((o) => ({ ...o, expiresAt: o.expiresAt.toISOString() })), now);
  // The offer the explanation is about: the accepted one, or else the one that is running.
  const current = offers.find((o) => o.status === 'accepted') ?? offers[0] ?? null;

  return {
    request: {
      stage,
      createdAt: record.createdAt.toISOString(),
      firstName: record.firstName,
      postalCode: formatPostalCode(record.postalCode),
      carDrivable: record.carDrivable,
      carLocation: record.carLocation,
      car: record.car,
      damage: record.damage,
      preferences: record.preferences,
      images: record.imagePaths.map((path) => ({ url: imageUrls.get(path) })).filter((image) => image.url),
    },
    offers,
    nextSteps: buildNextSteps({
      stage,
      carDrivable: record.carDrivable,
      carLocation: record.carLocation,
      damageType: record.damage.damageType,
      preferences: record.preferences.map((p) => p.slug),
      garage: current ? { companyName: current.garage.companyName, address: current.garage.address, phone: current.garage.phone } : null,
      availableFrom: current?.availableFrom ?? null,
      expiresAt: current?.expiresAt ?? null,
    }),
  };
}

module.exports = { presentCustomerView, presentOffers, formatPostalCode };
