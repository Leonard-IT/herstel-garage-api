'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

const DUPLICATE_KEY_ERRORS = [2601, 2627];

/**
 * Stores an offer by a garage on an open repair request.
 *
 * Returns the new offer, or null when the request does not exist or is not open (anymore).
 * Throws an error with statusCode 409 when the request is in option, i.e. an offer on it is active and has not passed its deadline:
 * error.code is 'already_offered' when that offer is this garage's own, and 'in_option' when it is another garage's (the request is
 * reserved for that garage until its deadline). An offer that has passed its deadline never blocks anyone.
 */
async function createOffer({ repairRequestId, garageId, userId, availableFrom, validityHours }) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Lock the request while checking it, so it cannot be closed between the check and the insert.
    const open = await new sql.Request(tx)
      .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
      .query("SELECT Id FROM dbo.RepairRequests WITH (UPDLOCK, HOLDLOCK) WHERE Id = @repairRequestId AND Status = 'open'");
    if (!open.recordset.length) {
      await tx.rollback();
      return null;
    }

    // Offers that have passed their deadline are marked expired, so they stop blocking the unique "one active offer" index.
    await new sql.Request(tx)
      .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
      .query(`UPDATE dbo.Offers SET Status = 'expired'
              WHERE RepairRequestId = @repairRequestId AND Status = 'active' AND ExpiresAt <= SYSUTCDATETIME()`);

    // The request is reserved while an offer is running. The lock on the request above makes two garages wait for each other here,
    // so only one of them can ever get an offer in.
    const running = await new sql.Request(tx)
      .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
      .query("SELECT TOP 1 GarageId FROM dbo.Offers WHERE RepairRequestId = @repairRequestId AND Status = 'active' AND ExpiresAt > SYSUTCDATETIME()");
    if (running.recordset.length) {
      await tx.rollback();
      const own = String(running.recordset[0].GarageId).toLowerCase() === String(garageId).toLowerCase();
      throw Object.assign(new Error('Request is in option'), { statusCode: 409, code: own ? 'already_offered' : 'in_option' });
    }

    // The date goes in as text and is converted by SQL Server, so no time zone conversion can shift it by a day.
    const result = await new sql.Request(tx)
      .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
      .input('garageId', sql.UniqueIdentifier, garageId)
      .input('userId', sql.UniqueIdentifier, userId)
      .input('availableFrom', sql.Char(10), availableFrom)
      .input('validityHours', sql.SmallInt, validityHours)
      .query(`INSERT INTO dbo.Offers (RepairRequestId, GarageId, CreatedByUserId, AvailableFrom, ValidityHours, ExpiresAt)
              OUTPUT inserted.Id, inserted.RepairRequestId, CONVERT(char(10), inserted.AvailableFrom, 23) AS AvailableFrom,
                     inserted.ValidityHours, inserted.ExpiresAt, inserted.Status, inserted.CreatedAt
              VALUES (@repairRequestId, @garageId, @userId, CAST(@availableFrom AS date), @validityHours,
                      DATEADD(HOUR, @validityHours, SYSUTCDATETIME()))`);
    await tx.commit();

    const row = result.recordset[0];
    return {
      id: row.Id,
      repairRequestId: row.RepairRequestId,
      availableFrom: row.AvailableFrom,
      validityHours: row.ValidityHours,
      expiresAt: row.ExpiresAt.toISOString(),
      status: row.Status,
      createdAt: row.CreatedAt.toISOString(),
    };
  } catch (err) {
    await tx.rollback().catch(() => {});
    if (DUPLICATE_KEY_ERRORS.includes(err.number)) Object.assign(err, { statusCode: 409, code: 'already_offered' });
    throw err;
  }
}

module.exports = { createOffer };
