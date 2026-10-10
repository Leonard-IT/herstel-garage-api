'use strict';

const MAX_DAMAGES = 10;
const MAX_IMAGES_PER_DAMAGE = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
// Same vocabulary as the garage specializations, so requests can be matched to garages.
const DAMAGE_TYPES = ['lakschade', 'carrosserie', 'ruitschade', 'bumper', 'ev', 'overig'];
const DAMAGE_LOCATIONS = ['front', 'rear', 'left', 'right', 'roof', 'windscreen', 'wheels', 'interior', 'other'];
// Whether the car can still be driven safely, and where it is now: they decide the customer's next steps after accepting an offer.
// Optional, so a form that does not ask yet still works; stored as NULL then.
const CAR_DRIVABLE = ['yes', 'no', 'unknown'];
const CAR_LOCATIONS = ['home', 'towing', 'other'];
// Paths handed out by createDamageImageUploadUrls: pending/<guid>.<ext>
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_BLOB_PATH = /^pending\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic)$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates and normalizes a repair request submission.
 * Returns { value } on success or { errors: { field: message } } on failure.
 * Preference slugs and image blobs are checked against the database / blob storage by the caller.
 */
function validateRepairRequest(body) {
  const errors = {};
  if (!isObject(body)) return { errors: { body: 'Request body must be a JSON object' } };
  const customer = isObject(body.customer) ? body.customer : {};
  const car = isObject(body.car) ? body.car : {};

  const firstName = str(customer.firstName);
  if (!firstName) errors['customer.firstName'] = 'Required';
  else if (firstName.length > 100) errors['customer.firstName'] = 'Too long (max 100)';
  const lastName = str(customer.lastName);
  if (!lastName) errors['customer.lastName'] = 'Required';
  else if (lastName.length > 100) errors['customer.lastName'] = 'Too long (max 100)';
  const email = str(customer.email).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors['customer.email'] = 'Must be a valid email address';
  const phone = str(customer.phone);
  if (phone.length > 30 || phone.replace(/\D/g, '').length < 8) errors['customer.phone'] = 'Must be a valid phone number';

  const postalCode = str(body.postalCode).replace(/\s/g, '').toUpperCase();
  if (!/^[1-9]\d{3}[A-Z]{2}$/.test(postalCode)) errors.postalCode = 'Expected format 1234 AB';

  // One id per form submission: a retry of the same submission must not create duplicates.
  const submissionId = str(body.submissionId).toLowerCase();
  if (!GUID.test(submissionId)) errors.submissionId = 'Must be a GUID generated once per submission';

  const licensePlate = str(car.licensePlate).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(licensePlate)) errors['car.licensePlate'] = 'Must be a valid Dutch license plate';
  const make = str(car.make);
  if (!make) errors['car.make'] = 'Required';
  else if (make.length > 100) errors['car.make'] = 'Too long (max 100)';
  const model = str(car.model);
  if (!model) errors['car.model'] = 'Required';
  else if (model.length > 100) errors['car.model'] = 'Too long (max 100)';
  let buildYear = null;
  if (car.buildYear !== undefined && car.buildYear !== null && car.buildYear !== '') {
    buildYear = Number(car.buildYear);
    if (!Number.isInteger(buildYear) || buildYear < 1900 || buildYear > new Date().getFullYear() + 1) {
      errors['car.buildYear'] = 'Must be a valid year';
    }
  }

  const carDrivable = str(body.carDrivable) || null;
  if (carDrivable && !CAR_DRIVABLE.includes(carDrivable)) errors.carDrivable = `Must be one of: ${CAR_DRIVABLE.join(', ')}`;
  const carLocation = str(body.carLocation) || null;
  if (carLocation && !CAR_LOCATIONS.includes(carLocation)) errors.carLocation = `Must be one of: ${CAR_LOCATIONS.join(', ')}`;

  const damages = [];
  if (!Array.isArray(body.damages) || body.damages.length === 0) {
    errors.damages = 'At least one damage is required';
  } else if (body.damages.length > MAX_DAMAGES) {
    errors.damages = `At most ${MAX_DAMAGES} damages per request`;
  } else {
    const seenImages = new Set();
    body.damages.forEach((raw, i) => {
      const prefix = `damages[${i}]`;
      const damage = isObject(raw) ? raw : {};

      const description = str(damage.description);
      if (!description) errors[`${prefix}.description`] = 'Required';
      else if (description.length > 2000) errors[`${prefix}.description`] = 'Too long (max 2000)';

      const damageType = str(damage.damageType);
      if (!DAMAGE_TYPES.includes(damageType)) errors[`${prefix}.damageType`] = `Must be one of: ${DAMAGE_TYPES.join(', ')}`;

      const location = str(damage.location);
      if (location && !DAMAGE_LOCATIONS.includes(location)) {
        errors[`${prefix}.location`] = `Must be one of: ${DAMAGE_LOCATIONS.join(', ')}`;
      }

      let images = [];
      if (!Array.isArray(damage.images) || damage.images.length === 0) {
        errors[`${prefix}.images`] = 'At least one image is required';
      } else if (damage.images.length > MAX_IMAGES_PER_DAMAGE) {
        errors[`${prefix}.images`] = `At most ${MAX_IMAGES_PER_DAMAGE} images per damage`;
      } else if (damage.images.some((p) => typeof p !== 'string' || !PENDING_BLOB_PATH.test(p))) {
        errors[`${prefix}.images`] = 'Must contain only upload paths returned by the upload-url endpoint';
      } else if (new Set(damage.images).size !== damage.images.length || damage.images.some((p) => seenImages.has(p))) {
        errors[`${prefix}.images`] = 'Each image can only be used once';
      } else {
        images = damage.images;
        images.forEach((p) => seenImages.add(p));
      }

      let preferences = [];
      const rawPreferences = damage.preferences ?? [];
      if (!Array.isArray(rawPreferences) || rawPreferences.some((p) => typeof p !== 'string' || !/^[a-z0-9-]{1,50}$/.test(p))) {
        errors[`${prefix}.preferences`] = 'Must be an array of preference slugs';
      } else {
        preferences = [...new Set(rawPreferences)];
      }

      damages.push({ description, damageType, location: location || null, images, preferences });
    });
  }

  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      submissionId,
      postalCode,
      carDrivable,
      carLocation,
      customer: { firstName, lastName, email, phone },
      car: { licensePlate, make, model, buildYear },
      damages,
    },
  };
}

/**
 * Validates a request for upload URLs: { files: [{ contentType }] }.
 */
function validateUploadUrlRequest(body) {
  if (!isObject(body)) return { errors: { body: 'Request body must be a JSON object' } };
  const errors = {};
  const files = [];
  if (!Array.isArray(body.files) || body.files.length === 0) {
    errors.files = 'At least one file is required';
  } else if (body.files.length > MAX_IMAGES_PER_DAMAGE) {
    errors.files = `At most ${MAX_IMAGES_PER_DAMAGE} files per request`;
  } else {
    body.files.forEach((file, i) => {
      const contentType = str(isObject(file) ? file.contentType : '').toLowerCase();
      if (!IMAGE_TYPES[contentType]) errors[`files[${i}].contentType`] = `Must be one of: ${Object.keys(IMAGE_TYPES).join(', ')}`;
      else files.push({ contentType, extension: IMAGE_TYPES[contentType] });
    });
  }
  if (Object.keys(errors).length) return { errors };
  return { value: { files } };
}

module.exports = {
  validateRepairRequest,
  validateUploadUrlRequest,
  MAX_IMAGE_BYTES,
  IMAGE_TYPES,
  DAMAGE_LOCATIONS,
  DAMAGE_TYPES,
  CAR_DRIVABLE,
  CAR_LOCATIONS,
};
