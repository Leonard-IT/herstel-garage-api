'use strict';

const { randomUUID } = require('node:crypto');
const { app } = require('@azure/functions');
const { validateRepairRequest } = require('../lib/repairValidation');
const { getActivePreferences, createRepairRequests } = require('../lib/repairRequestRepository');
const { inspectUploads, copyBlob, discard } = require('../lib/blobStorage');
const { customerPageUrl } = require('../lib/customerLink');
const { tryGeocode } = require('../lib/geocoder');

// The customer token only leaves the API inside the link to the customer's own page.
const present = (requests) => requests.map(({ customerToken, ...request }) => ({
  ...request,
  customerUrl: customerToken ? customerPageUrl(customerToken) : null,
}));

const validationFailed = (details) => ({
  status: 422,
  jsonBody: { error: 'validation_failed', message: 'Validation failed', details },
});

app.http('submitRepairRequest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'repair-requests',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json', message: 'Request body must be valid JSON' } };
    }

    const { value, errors } = validateRepairRequest(body);
    if (errors) return validationFailed(errors);

    const copied = [];
    try {
      // Preferences are maintained in the database, so they can only be checked here.
      const preferences = await getActivePreferences();
      const details = {};
      value.damages.forEach((damage, i) => {
        const unknown = damage.preferences.filter((slug) => !preferences.has(slug));
        if (unknown.length) details[`damages[${i}].preferences`] = `Unknown preferences: ${unknown.join(', ')}`;
      });

      const uploads = await inspectUploads(value.damages.flatMap((d) => d.images));
      if (uploads.errors) {
        value.damages.forEach((damage, i) => {
          const failed = damage.images.filter((p) => uploads.errors.has(p));
          if (failed.length) details[`damages[${i}].images`] = failed.map((p) => `${p}: ${uploads.errors.get(p)}`).join('; ');
        });
      }
      if (Object.keys(details).length) return validationFailed(details);

      // Move the uploads to their permanent location before the transaction, so a committed row never points to a
      // missing blob. If the transaction fails the copies are removed again.
      const damages = [];
      for (const damage of value.damages) {
        const id = randomUUID();
        const images = [];
        for (const [index, pendingPath] of damage.images.entries()) {
          const meta = uploads.images.get(pendingPath);
          const blobPath = `damage-reports/${id}/${index + 1}.${pendingPath.split('.').pop()}`;
          await copyBlob(pendingPath, blobPath);
          copied.push(blobPath);
          images.push({ blobPath, ...meta });
        }
        damages.push({
          id,
          description: damage.description,
          damageType: damage.damageType,
          location: damage.location,
          images,
          preferenceIds: damage.preferences.map((slug) => preferences.get(slug)),
        });
      }

      const { requests, duplicate } = await createRepairRequests({
        submissionId: value.submissionId,
        postalCode: value.postalCode,
        coordinates: await tryGeocode(value.postalCode, context),
        carDrivable: value.carDrivable,
        carLocation: value.carLocation,
        customer: value.customer,
        car: value.car,
        damages,
      });
      if (duplicate) {
        // A retry of a submission that was already stored: keep the first result, drop this attempt's copies.
        await discard(copied);
        await discard(value.damages.flatMap((d) => d.images));
        context.log(`Duplicate submission ${value.submissionId}, returning the existing requests`);
        return { status: 200, jsonBody: { repairRequests: present(requests) } };
      }
      await discard(value.damages.flatMap((d) => d.images));
      context.log(`Repair requests created: ${requests.map((r) => r.id).join(', ')}`);
      return { status: 201, jsonBody: { repairRequests: present(requests) } };
    } catch (err) {
      await discard(copied);
      context.error('Repair request submission failed.', err);
      return { status: 500, jsonBody: { error: 'internal_error', message: 'Submission failed, please try again later' } };
    }
  },
});
