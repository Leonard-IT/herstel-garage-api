'use strict';

const sql = require('mssql');
const { getPool } = require('./db');
const { createToken } = require('./shareToken');

/**
 * The customer's own request behind a customer token, or null when there is none. Everything the customer page shows, raw: the request,
 * its photos (blob paths), preferences and the offers on it with their garage. What is actually shown is decided by customerView.js.
 */
async function getCustomerRequest(token) {
  const pool = await getPool();
  const result = await pool.request().input('token', sql.Char(43), token).query(`
    SELECT rr.Id, rr.Status, rr.CreatedAt, rr.PostalCode, rr.ContactFirstName, rr.CarDrivable, rr.CarLocation,
           dr.Id AS DamageReportId, dr.Description, dr.DamageType, dr.DamageLocation,
           c.LicensePlate, c.Make, c.Model, c.BuildYear
    FROM dbo.RepairRequests rr
    JOIN dbo.DamageReports dr ON dr.Id = rr.DamageReportId
    JOIN dbo.Cars c ON c.Id = dr.CarId
    WHERE rr.CustomerToken = @token`);
  const row = result.recordset[0];
  if (!row) return null;

  const [images, preferences, offers] = await Promise.all([
    pool.request().input('damageReportId', sql.UniqueIdentifier, row.DamageReportId).query(`
      SELECT BlobPath FROM dbo.DamageReportImages WHERE DamageReportId = @damageReportId ORDER BY SortOrder`),
    pool.request().input('id', sql.UniqueIdentifier, row.Id).query(`
      SELECT p.Slug, p.Name FROM dbo.RepairRequestPreferences rp
      JOIN dbo.CustomerRepairPreferences p ON p.Id = rp.PreferenceId
      WHERE rp.RepairRequestId = @id ORDER BY p.SortOrder`),
    pool.request().input('id', sql.UniqueIdentifier, row.Id).query(`
      SELECT o.Id, o.Status, CONVERT(char(10), o.AvailableFrom, 23) AS AvailableFrom, o.ExpiresAt, o.CreatedAt, o.RespondedAt,
             g.Id AS GarageId, g.CompanyName, g.Street, g.PostalCode AS GaragePostalCode, g.City, g.Website, g.ContactPhone, g.ContactEmail,
             (SELECT STRING_AGG(a.Code, ',') FROM dbo.GarageAccreditations a WHERE a.GarageId = g.Id) AS Accreditations
      FROM dbo.Offers o
      JOIN dbo.Garages g ON g.Id = o.GarageId
      WHERE o.RepairRequestId = @id
      ORDER BY o.CreatedAt DESC`),
  ]);

  return {
    id: row.Id,
    status: row.Status,
    createdAt: row.CreatedAt,
    postalCode: row.PostalCode,
    firstName: row.ContactFirstName,
    carDrivable: row.CarDrivable,
    carLocation: row.CarLocation,
    car: { licensePlate: row.LicensePlate, make: row.Make, model: row.Model, buildYear: row.BuildYear },
    damage: { description: row.Description, damageType: row.DamageType, location: row.DamageLocation },
    imagePaths: images.recordset.map((r) => r.BlobPath),
    preferences: preferences.recordset.map((r) => ({ slug: r.Slug, name: r.Name })),
    offers: offers.recordset.map((r) => ({
      id: r.Id,
      status: r.Status,
      availableFrom: r.AvailableFrom,
      expiresAt: r.ExpiresAt,
      createdAt: r.CreatedAt,
      respondedAt: r.RespondedAt,
      garage: {
        id: r.GarageId,
        companyName: r.CompanyName,
        street: r.Street,
        postalCode: r.GaragePostalCode,
        city: r.City,
        website: r.Website,
        phone: r.ContactPhone,
        email: r.ContactEmail,
        accreditations: r.Accreditations ? r.Accreditations.split(',') : [],
      },
    })),
  };
}

/**
 * The customer accepts or declines an offer on their request. Returns { ok: true } or { error } with error one of:
 * 'not_found'      no request behind the token, or the offer is not on it;
 * 'request_closed' the request is no longer open (accepting only; another offer was accepted, or it was cancelled);
 * 'offer_expired'  the offer passed its deadline;
 * 'offer_closed'   the offer was declined or withdrawn already (or, when declining, accepted already).
 * Repeating the same answer (accept twice, decline twice) is fine and returns { ok: true }: a double tap or a retry after a lost
 * response must not show an error.
 */
async function respondToOffer({ token, offerId, action }) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Lock the request, so a garage cannot make an offer and a second answer cannot slip in while this one is decided.
    const requestRow = (await new sql.Request(tx).input('token', sql.Char(43), token)
      .query('SELECT Id, Status FROM dbo.RepairRequests WITH (UPDLOCK, HOLDLOCK) WHERE CustomerToken = @token')).recordset[0];
    if (!requestRow) return await rollback(tx, 'not_found');

    const offer = (await new sql.Request(tx)
      .input('offerId', sql.UniqueIdentifier, offerId)
      .input('requestId', sql.UniqueIdentifier, requestRow.Id)
      .query(`SELECT Id, Status, CASE WHEN ExpiresAt > SYSUTCDATETIME() THEN 1 ELSE 0 END AS Running
              FROM dbo.Offers WITH (UPDLOCK) WHERE Id = @offerId AND RepairRequestId = @requestId`)).recordset[0];
    if (!offer) return await rollback(tx, 'not_found');

    const error = answerError(action, requestRow.Status, offer.Status, Boolean(offer.Running));
    if (error === 'repeat') return await rollback(tx, null);
    if (error) return await rollback(tx, error);

    const update = (statement) => new sql.Request(tx)
      .input('offerId', sql.UniqueIdentifier, offerId)
      .input('requestId', sql.UniqueIdentifier, requestRow.Id)
      .query(statement);
    if (action === 'accept') {
      await update("UPDATE dbo.Offers SET Status = 'accepted', RespondedAt = SYSUTCDATETIME() WHERE Id = @offerId");
      await update("UPDATE dbo.RepairRequests SET Status = 'accepted' WHERE Id = @requestId");
      // Only one offer runs at a time today, but should there ever be more, the others are off once the customer chose.
      await update(`UPDATE dbo.Offers SET Status = 'declined', RespondedAt = SYSUTCDATETIME()
                    WHERE RepairRequestId = @requestId AND Id <> @offerId AND Status = 'active'`);
    } else {
      // The request stays open: other garages can make an offer again.
      await update("UPDATE dbo.Offers SET Status = 'declined', RespondedAt = SYSUTCDATETIME() WHERE Id = @offerId");
    }
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** Why an answer is not possible, 'repeat' when it was given before, or null when it can go ahead. */
function answerError(action, requestStatus, offerStatus, running) {
  if (action === 'accept') {
    if (offerStatus === 'accepted') return 'repeat';
    if (requestStatus !== 'open') return 'request_closed';
  } else if (offerStatus === 'declined') {
    return 'repeat';
  }
  if (offerStatus !== 'active') return 'offer_closed';
  if (!running) return 'offer_expired';
  return null;
}

async function rollback(tx, error) {
  await tx.rollback();
  return error ? { error } : { ok: true };
}

/**
 * The customer token of a request, made now when the request does not have one yet (requests from before migration 008). For the team,
 * to send a customer the link to their page. Returns null when there is no such request.
 */
async function ensureCustomerToken(repairRequestId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.UniqueIdentifier, repairRequestId)
    .input('token', sql.Char(43), createToken())
    .query(`UPDATE dbo.RepairRequests SET CustomerToken = COALESCE(CustomerToken, @token)
            OUTPUT inserted.CustomerToken WHERE Id = @id`);
  return result.recordset[0]?.CustomerToken ?? null;
}

module.exports = { getCustomerRequest, respondToOffer, answerError, ensureCustomerToken };
