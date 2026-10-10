'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

const DUPLICATE_KEY_ERRORS = [2601, 2627];

/**
 * The prospect a new registration belongs to, if any: the prospect of the share link it came through (the invitation token), or else
 * a prospect with the same KvK number. Prospects that signed up already are skipped, and so is a revoked link. An expired link still
 * counts: the garage was invited, it only took a while.
 * Returns { prospectId, invited } or null. Runs in the registration's transaction and locks the prospect.
 */
async function findProspect(tx, { invitationToken, kvkNumber }) {
  if (invitationToken) {
    const invited = await new sql.Request(tx).input('token', sql.Char(43), invitationToken).query(`
      SELECT p.Id FROM dbo.RepairRequestShareLinks l
      JOIN dbo.GarageProspects p WITH (UPDLOCK, HOLDLOCK) ON p.Id = l.ProspectId
      WHERE l.Token = @token AND l.RevokedAt IS NULL AND p.GarageId IS NULL`);
    if (invited.recordset.length) return { prospectId: invited.recordset[0].Id, invited: true };
  }
  const byKvk = await new sql.Request(tx).input('kvkNumber', sql.Char(8), kvkNumber).query(`
    SELECT Id FROM dbo.GarageProspects WITH (UPDLOCK, HOLDLOCK) WHERE KvkNumber = @kvkNumber AND GarageId IS NULL`);
  return byKvk.recordset.length ? { prospectId: byKvk.recordset[0].Id, invited: false } : null;
}

/**
 * Persists a new garage registration.
 *
 * A garage that signs up through the link of an invitation (`invitationToken`, the token of a share link made for a prospect) is
 * approved straight away: we reached out to it, so it is in the network at once. Every other registration is "pending" until someone
 * approves it. Either way a matching prospect (by invitation, or by KvK number) is linked to the new garage and marked 'registered'.
 *
 * `coordinates` ({ latitude, longitude } of the postal code, or null when unknown) is what distances to repair requests are worked out from.
 *
 * Returns { id, status, registeredAt, invited }. A duplicate KvK number throws an error with statusCode 409.
 */
async function createGarage(garage, { invitationToken = null, coordinates = null } = {}) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const { contact } = garage;
    const prospect = await findProspect(tx, { invitationToken, kvkNumber: garage.kvkNumber });
    const status = prospect?.invited ? 'approved' : 'pending';
    const result = await new sql.Request(tx)
      .input('status', sql.VarChar(20), status)
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
      .input('latitude', sql.Decimal(9, 6), coordinates?.latitude ?? null)
      .input('longitude', sql.Decimal(9, 6), coordinates?.longitude ?? null)
      .query(`
        INSERT INTO dbo.Garages (
          CompanyName, KvkNumber, VatNumber, Street, PostalCode, City, Website,
          ContactFirstName, ContactLastName, ContactJobTitle, ContactEmail, ContactPhone,
          ServiceArea, EmployeeCount, LiftCount, HasLiabilityInsurance, Iban, AcceptedTermsAt, NewsletterOptIn, Status,
          Latitude, Longitude)
        OUTPUT inserted.Id, inserted.Status, inserted.RegisteredAt
        VALUES (
          @companyName, @kvkNumber, @vatNumber, @street, @postalCode, @city, @website,
          @contactFirstName, @contactLastName, @contactJobTitle, @contactEmail, @contactPhone,
          @serviceArea, @employeeCount, @liftCount, @hasLiabilityInsurance, @iban, SYSUTCDATETIME(), @newsletterOptIn, @status,
          @latitude, @longitude)`);
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

    if (prospect) {
      await new sql.Request(tx)
        .input('prospectId', sql.UniqueIdentifier, prospect.prospectId)
        .input('garageId', sql.UniqueIdentifier, row.Id)
        .query("UPDATE dbo.GarageProspects SET GarageId = @garageId, Status = 'registered' WHERE Id = @prospectId");
    }

    await tx.commit();
    return { id: row.Id, status: row.Status, registeredAt: row.RegisteredAt.toISOString(), invited: Boolean(prospect?.invited) };
  } catch (err) {
    await tx.rollback().catch(() => {});
    if (DUPLICATE_KEY_ERRORS.includes(err.number)) err.statusCode = 409;
    throw err;
  }
}

module.exports = { createGarage };
