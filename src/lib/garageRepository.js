'use strict';

const sql = require('mssql');
const { buildSqlConfig } = require('./sqlConfig');

const DUPLICATE_KEY_ERRORS = [2601, 2627];
let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(buildSqlConfig(process.env.SQL_CONNECTION_STRING)).connect();
    poolPromise.catch(() => { poolPromise = undefined; });
  }
  return poolPromise;
}

/**
 * Persists a new garage registration (status "pending").
 * A duplicate KvK number throws an error with statusCode 409.
 */
async function createGarage(garage) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const { contact } = garage;
    const result = await new sql.Request(tx)
      .input('companyName', sql.NVarChar(200), garage.companyName)
      .input('kvkNumber', sql.Char(8), garage.kvkNumber)
      .input('vatNumber', sql.VarChar(14), garage.vatNumber || null)
      .input('street', sql.NVarChar(200), garage.street)
      .input('postalCode', sql.Char(6), garage.postalCode)
      .input('city', sql.NVarChar(100), garage.city)
      .input('website', sql.NVarChar(500), garage.website || null)
      .input('contactFirstName', sql.NVarChar(100), contact.firstName)
      .input('contactLastName', sql.NVarChar(100), contact.lastName)
      .input('contactJobTitle', sql.NVarChar(100), contact.jobTitle || null)
      .input('contactEmail', sql.NVarChar(254), contact.email)
      .input('contactPhone', sql.NVarChar(30), contact.phone)
      .input('serviceArea', sql.NVarChar(500), garage.serviceArea)
      .input('employeeCount', sql.VarChar(10), garage.employeeCount || null)
      .input('liftCount', sql.Int, garage.liftCount)
      .input('hasLiabilityInsurance', sql.Bit, garage.hasLiabilityInsurance)
      .input('iban', sql.VarChar(34), garage.iban)
      .input('newsletterOptIn', sql.Bit, garage.newsletterOptIn)
      .query(`
        INSERT INTO dbo.Garages (
          CompanyName, KvkNumber, VatNumber, Street, PostalCode, City, Website,
          ContactFirstName, ContactLastName, ContactJobTitle, ContactEmail, ContactPhone,
          ServiceArea, EmployeeCount, LiftCount, HasLiabilityInsurance, Iban, AcceptedTermsAt, NewsletterOptIn)
        OUTPUT inserted.Id, inserted.Status, inserted.RegisteredAt
        VALUES (
          @companyName, @kvkNumber, @vatNumber, @street, @postalCode, @city, @website,
          @contactFirstName, @contactLastName, @contactJobTitle, @contactEmail, @contactPhone,
          @serviceArea, @employeeCount, @liftCount, @hasLiabilityInsurance, @iban, SYSUTCDATETIME(), @newsletterOptIn)`);
    const row = result.recordset[0];

    const insertCodes = async (table, codes) => {
      for (const code of codes) {
        await new sql.Request(tx)
          .input('garageId', sql.UniqueIdentifier, row.Id)
          .input('code', sql.VarChar(30), code)
          .query(`INSERT INTO dbo.${table} (GarageId, Code) VALUES (@garageId, @code)`);
      }
    };
    await insertCodes('GarageSpecializations', garage.specializations);
    await insertCodes('GarageAccreditations', garage.accreditations);

    await tx.commit();
    return { id: row.Id, status: row.Status, registeredAt: row.RegisteredAt.toISOString() };
  } catch (err) {
    await tx.rollback().catch(() => {});
    if (DUPLICATE_KEY_ERRORS.includes(err.number)) err.statusCode = 409;
    throw err;
  }
}

module.exports = { createGarage };
