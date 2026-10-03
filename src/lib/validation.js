'use strict';

const EMPLOYEE_COUNTS = ['1-5', '6-15', '16-30', '30+'];
const SPECIALIZATIONS = ['lakschade', 'carrosserie', 'ruitschade', 'bumper', 'ev', 'oldtimers', 'overig'];
const ACCREDITATIONS = ['rdw', 'focwa', 'bovag', 'iso'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function isValidIban(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates and normalizes a garage registration payload.
 * Returns { value } on success or { errors: { field: message } } on failure.
 */
function validateRegistration(body) {
  const errors = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object' } };
  }
  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};

  const companyName = str(body.companyName);
  if (!companyName) errors.companyName = 'Required';
  else if (companyName.length > 200) errors.companyName = 'Too long (max 200)';

  const kvkNumber = str(body.kvkNumber).replace(/\s/g, '');
  if (!/^\d{8}$/.test(kvkNumber)) errors.kvkNumber = 'Must be 8 digits';

  const vatNumber = str(body.vatNumber).replace(/[\s.]/g, '').toUpperCase();
  if (vatNumber && !/^NL\d{9}B\d{2}$/.test(vatNumber)) errors.vatNumber = 'Expected format NL000000000B00';

  const street = str(body.street);
  if (!street) errors.street = 'Required';

  const postalCode = str(body.postalCode).replace(/\s/g, '').toUpperCase();
  if (!/^\d{4}[A-Z]{2}$/.test(postalCode)) errors.postalCode = 'Expected format 1234 AB';

  const city = str(body.city);
  if (!city) errors.city = 'Required';

  const website = str(body.website);
  if (website && !isValidUrl(website)) errors.website = 'Must be a valid http(s) URL';

  const firstName = str(contact.firstName);
  if (!firstName) errors['contact.firstName'] = 'Required';
  const lastName = str(contact.lastName);
  if (!lastName) errors['contact.lastName'] = 'Required';
  const jobTitle = str(contact.jobTitle);

  const email = str(contact.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors['contact.email'] = 'Must be a valid email address';

  const phone = str(contact.phone);
  if (phone.replace(/\D/g, '').length < 8) errors['contact.phone'] = 'Must be a valid phone number';

  const serviceArea = str(body.serviceArea);
  if (!serviceArea) errors.serviceArea = 'Required';

  const employeeCount = str(body.employeeCount);
  if (employeeCount && !EMPLOYEE_COUNTS.includes(employeeCount)) {
    errors.employeeCount = `Must be one of: ${EMPLOYEE_COUNTS.join(', ')}`;
  }

  let liftCount = null;
  if (body.liftCount !== undefined && body.liftCount !== null && body.liftCount !== '') {
    liftCount = Number(body.liftCount);
    if (!Number.isInteger(liftCount) || liftCount < 0) errors.liftCount = 'Must be a non-negative integer';
  }

  const list = (field, allowed) => {
    const raw = body[field] ?? [];
    if (!Array.isArray(raw) || raw.some((v) => !allowed.includes(v))) {
      errors[field] = `Must be an array containing only: ${allowed.join(', ')}`;
      return [];
    }
    return [...new Set(raw)];
  };
  const specializations = list('specializations', SPECIALIZATIONS);
  const accreditations = list('accreditations', ACCREDITATIONS);

  if (body.hasLiabilityInsurance !== true) errors.hasLiabilityInsurance = 'Liability insurance must be confirmed';

  const iban = str(body.iban).replace(/\s/g, '').toUpperCase();
  if (!isValidIban(iban)) errors.iban = 'Must be a valid IBAN';

  if (body.acceptedTerms !== true) errors.acceptedTerms = 'Terms and privacy policy must be accepted';

  if (Object.keys(errors).length) return { errors };

  return {
    value: {
      companyName,
      kvkNumber,
      vatNumber,
      street,
      postalCode,
      city,
      website,
      contact: { firstName, lastName, jobTitle, email, phone },
      serviceArea,
      employeeCount,
      liftCount,
      specializations,
      accreditations,
      hasLiabilityInsurance: true,
      iban,
      acceptedTerms: true,
      newsletterOptIn: body.newsletterOptIn === true,
    },
  };
}

module.exports = { validateRegistration, isValidIban };
