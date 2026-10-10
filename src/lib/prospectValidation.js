'use strict';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** "www.garage.nl" and "garage.nl" are accepted as https addresses; anything else must be a valid http(s) URL. */
function normalizeWebsite(value) {
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.') ? withScheme : null;
  } catch {
    return null;
  }
}

/**
 * Validates a new prospect: { companyName, city, street?, postalCode?, phone?, email?, website?, kvkNumber?, notes? }.
 * Only the name and the place are required: of a prospect we often know little more. Returns { value } or { errors }.
 */
function validateProspect(body) {
  if (!isObject(body)) return { errors: { body: 'Request body must be a JSON object' } };
  const errors = {};

  const companyName = str(body.companyName);
  if (!companyName) errors.companyName = 'Required';
  else if (companyName.length > 200) errors.companyName = 'Too long (max 200)';

  const city = str(body.city);
  if (!city) errors.city = 'Required';
  else if (city.length > 100) errors.city = 'Too long (max 100)';

  const street = str(body.street);
  if (street.length > 200) errors.street = 'Too long (max 200)';

  const postalCode = str(body.postalCode).replace(/\s/g, '').toUpperCase();
  if (postalCode && !/^[1-9]\d{3}[A-Z]{2}$/.test(postalCode)) errors.postalCode = 'Expected format 1234 AB';

  const phone = str(body.phone);
  if (phone && (phone.length > 30 || phone.replace(/\D/g, '').length < 8)) errors.phone = 'Must be a valid phone number';

  const email = str(body.email).toLowerCase();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = 'Must be a valid email address';

  const website = normalizeWebsite(str(body.website));
  if (website === null) errors.website = 'Must be a website address';
  else if (website.length > 500) errors.website = 'Too long (max 500)';

  const kvkNumber = str(body.kvkNumber).replace(/\s/g, '');
  if (kvkNumber && !/^\d{8}$/.test(kvkNumber)) errors.kvkNumber = 'Must be 8 digits';

  const notes = str(body.notes);
  if (notes.length > 2000) errors.notes = 'Too long (max 2000)';

  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      companyName,
      city,
      street: street || null,
      postalCode: postalCode || null,
      phone: phone || null,
      email: email || null,
      website: website || null,
      kvkNumber: kvkNumber || null,
      notes: notes || null,
    },
  };
}

module.exports = { validateProspect, normalizeWebsite };
