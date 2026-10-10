'use strict';

const sql = require('mssql');
const { getPool } = require('./db');
const { createToken } = require('./shareToken');

const DUPLICATE_KEY_ERRORS = [2601, 2627];
const SUBMISSION_INDEX = 'UX_RepairRequests_Submission';

/** Returns Map(slug -> id) of the preferences a customer can currently choose from. */
async function getActivePreferences() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT Id, Slug FROM dbo.CustomerRepairPreferences WHERE IsActive = 1');
  return new Map(result.recordset.map((r) => [r.Slug, r.Id]));
}

/** Returns the selectable preferences ([{ slug, name }]) in display order. */
async function listActivePreferences() {
  const pool = await getPool();
  const result = await pool.request().query(
    'SELECT Slug, Name FROM dbo.CustomerRepairPreferences WHERE IsActive = 1 ORDER BY SortOrder, Name',
  );
  return result.recordset.map((r) => ({ slug: r.Slug, name: r.Name }));
}

/**
 * Persists a submission: customer (reused by email), car (reused by license plate), and per damage a damage report,
 * its images and a repair request with the chosen preferences, all in one transaction.
 *
 * Existing customers and cars are never updated from anonymous input. Ownership is only recorded when the car has no
 * current owner; a car owned by someone else keeps its owner (changing owners needs a verified flow).
 *
 * Submissions are idempotent: when `submissionId` was already stored (a retry), nothing is written and the existing
 * requests are returned with `duplicate: true`.
 *
 * Each damage must carry a pre-generated `id`, `damageType`, `images: [{ blobPath, contentType, sizeBytes }]`
 * and `preferenceIds: number[]`.
 * Every request gets its own customer token: the secret in the customer's link to that request (see migration 008).
 * `coordinates` ({ latitude, longitude } of the postal code, or null when unknown) is stored on every request, for the distance a
 * garage sees. Returns { requests, duplicate }; each request carries its customerToken.
 */
async function createRepairRequests({
  submissionId, postalCode, coordinates = null, carDrivable = null, carLocation = null, customer, car, damages,
}) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const customerId = await findOrCreate(
      tx,
      'SELECT Id FROM dbo.Customers WITH (UPDLOCK, HOLDLOCK) WHERE Email = @email',
      (r) => r.input('email', sql.NVarChar(254), customer.email),
      `INSERT INTO dbo.Customers (FirstName, LastName, Email, Phone) OUTPUT inserted.Id
       VALUES (@firstName, @lastName, @email, @phone)`,
      (r) => r
        .input('firstName', sql.NVarChar(100), customer.firstName)
        .input('lastName', sql.NVarChar(100), customer.lastName)
        .input('email', sql.NVarChar(254), customer.email)
        .input('phone', sql.NVarChar(30), customer.phone),
    );

    const carId = await findOrCreate(
      tx,
      'SELECT Id FROM dbo.Cars WITH (UPDLOCK, HOLDLOCK) WHERE LicensePlate = @licensePlate',
      (r) => r.input('licensePlate', sql.Char(6), car.licensePlate),
      `INSERT INTO dbo.Cars (LicensePlate, Make, Model, BuildYear) OUTPUT inserted.Id
       VALUES (@licensePlate, @make, @model, @buildYear)`,
      (r) => r
        .input('licensePlate', sql.Char(6), car.licensePlate)
        .input('make', sql.NVarChar(100), car.make)
        .input('model', sql.NVarChar(100), car.model)
        .input('buildYear', sql.SmallInt, car.buildYear),
    );

    await new sql.Request(tx)
      .input('carId', sql.UniqueIdentifier, carId)
      .input('customerId', sql.UniqueIdentifier, customerId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.CarOwnerships WITH (UPDLOCK, HOLDLOCK) WHERE CarId = @carId AND OwnedUntil IS NULL)
          INSERT INTO dbo.CarOwnerships (CarId, CustomerId) VALUES (@carId, @customerId)`);

    const requests = [];
    for (const [damageIndex, damage] of damages.entries()) {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, damage.id)
        .input('carId', sql.UniqueIdentifier, carId)
        .input('description', sql.NVarChar(2000), damage.description)
        .input('damageType', sql.VarChar(30), damage.damageType)
        .input('location', sql.VarChar(30), damage.location)
        .query(`INSERT INTO dbo.DamageReports (Id, CarId, Description, DamageType, DamageLocation)
                VALUES (@id, @carId, @description, @damageType, @location)`);

      for (const [index, image] of damage.images.entries()) {
        await new sql.Request(tx)
          .input('damageReportId', sql.UniqueIdentifier, damage.id)
          .input('blobPath', sql.NVarChar(500), image.blobPath)
          .input('contentType', sql.VarChar(100), image.contentType)
          .input('sizeBytes', sql.BigInt, image.sizeBytes)
          .input('sortOrder', sql.Int, index)
          .query(`INSERT INTO dbo.DamageReportImages (DamageReportId, BlobPath, ContentType, SizeBytes, SortOrder)
                  VALUES (@damageReportId, @blobPath, @contentType, @sizeBytes, @sortOrder)`);
      }

      const result = await new sql.Request(tx)
        .input('damageReportId', sql.UniqueIdentifier, damage.id)
        .input('customerId', sql.UniqueIdentifier, customerId)
        .input('postalCode', sql.Char(6), postalCode)
        .input('contactFirstName', sql.NVarChar(100), customer.firstName)
        .input('contactLastName', sql.NVarChar(100), customer.lastName)
        .input('contactPhone', sql.NVarChar(30), customer.phone)
        .input('submissionId', sql.UniqueIdentifier, submissionId)
        .input('submissionIndex', sql.TinyInt, damageIndex)
        .input('customerToken', sql.Char(43), createToken())
        .input('carDrivable', sql.VarChar(10), carDrivable)
        .input('carLocation', sql.VarChar(20), carLocation)
        .input('latitude', sql.Decimal(9, 6), coordinates?.latitude ?? null)
        .input('longitude', sql.Decimal(9, 6), coordinates?.longitude ?? null)
        .query(`INSERT INTO dbo.RepairRequests (DamageReportId, CustomerId, PostalCode, ContactFirstName, ContactLastName,
                  ContactPhone, SubmissionId, SubmissionIndex, CustomerToken, CarDrivable, CarLocation, Latitude, Longitude)
                OUTPUT inserted.Id, inserted.Status, inserted.CreatedAt, inserted.CustomerToken
                VALUES (@damageReportId, @customerId, @postalCode, @contactFirstName, @contactLastName,
                  @contactPhone, @submissionId, @submissionIndex, @customerToken, @carDrivable, @carLocation, @latitude, @longitude)`);
      const row = result.recordset[0];

      for (const preferenceId of damage.preferenceIds) {
        await new sql.Request(tx)
          .input('repairRequestId', sql.UniqueIdentifier, row.Id)
          .input('preferenceId', sql.Int, preferenceId)
          .query('INSERT INTO dbo.RepairRequestPreferences (RepairRequestId, PreferenceId) VALUES (@repairRequestId, @preferenceId)');
      }
      requests.push({
        id: row.Id, damageReportId: damage.id, status: row.Status, createdAt: row.CreatedAt.toISOString(), customerToken: row.CustomerToken,
      });
    }

    await tx.commit();
    return { requests, duplicate: false };
  } catch (err) {
    await tx.rollback().catch(() => {});
    if (DUPLICATE_KEY_ERRORS.includes(err.number) && err.message.includes(SUBMISSION_INDEX)) {
      return { requests: await findBySubmission(submissionId), duplicate: true };
    }
    throw err;
  }
}

async function findBySubmission(submissionId) {
  const pool = await getPool();
  const result = await pool.request().input('submissionId', sql.UniqueIdentifier, submissionId).query(`
    SELECT Id, DamageReportId, Status, CreatedAt, CustomerToken FROM dbo.RepairRequests
    WHERE SubmissionId = @submissionId ORDER BY SubmissionIndex`);
  return result.recordset.map((r) => ({
    id: r.Id, damageReportId: r.DamageReportId, status: r.Status, createdAt: r.CreatedAt.toISOString(), customerToken: r.CustomerToken,
  }));
}

async function findOrCreate(tx, selectSql, bindSelect, insertSql, bindInsert) {
  const existing = await bindSelect(new sql.Request(tx)).query(selectSql);
  if (existing.recordset.length) return existing.recordset[0].Id;
  const created = await bindInsert(new sql.Request(tx)).query(insertSql);
  return created.recordset[0].Id;
}

module.exports = { getActivePreferences, listActivePreferences, createRepairRequests };
