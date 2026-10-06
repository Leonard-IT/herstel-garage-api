'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

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
 * Each damage must carry a pre-generated `id`, `images: [{ blobPath, contentType, sizeBytes }]`
 * and `preferenceIds: number[]`.
 */
async function createRepairRequests({ customer, car, damages }) {
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
    for (const damage of damages) {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, damage.id)
        .input('carId', sql.UniqueIdentifier, carId)
        .input('description', sql.NVarChar(2000), damage.description)
        .input('location', sql.VarChar(30), damage.location)
        .query(`INSERT INTO dbo.DamageReports (Id, CarId, Description, DamageLocation)
                VALUES (@id, @carId, @description, @location)`);

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
        .query(`INSERT INTO dbo.RepairRequests (DamageReportId, CustomerId)
                OUTPUT inserted.Id, inserted.Status, inserted.CreatedAt
                VALUES (@damageReportId, @customerId)`);
      const row = result.recordset[0];

      for (const preferenceId of damage.preferenceIds) {
        await new sql.Request(tx)
          .input('repairRequestId', sql.UniqueIdentifier, row.Id)
          .input('preferenceId', sql.Int, preferenceId)
          .query('INSERT INTO dbo.RepairRequestPreferences (RepairRequestId, PreferenceId) VALUES (@repairRequestId, @preferenceId)');
      }
      requests.push({ id: row.Id, damageReportId: damage.id, status: row.Status, createdAt: row.CreatedAt.toISOString() });
    }

    await tx.commit();
    return requests;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function findOrCreate(tx, selectSql, bindSelect, insertSql, bindInsert) {
  const existing = await bindSelect(new sql.Request(tx)).query(selectSql);
  if (existing.recordset.length) return existing.recordset[0].Id;
  const created = await bindInsert(new sql.Request(tx)).query(insertSql);
  return created.recordset[0].Id;
}

module.exports = { getActivePreferences, listActivePreferences, createRepairRequests };
