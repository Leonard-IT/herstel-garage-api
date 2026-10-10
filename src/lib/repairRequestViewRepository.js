'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

/**
 * Views by the same garage user on the same request closer together than this are one visit. Long enough that refreshing, going back
 * and forth between the overview and the request, or making an offer does not count twice; short enough that coming back later the
 * same day does.
 */
const VIEW_GAP_MINUTES = 30;

/**
 * Records that a garage user viewed a repair request, unless the same user already viewed it in the last VIEW_GAP_MINUTES. Only open
 * requests count: the same requests the detail endpoint shows.
 *
 * One statement, so it is safe when the page asks twice at once (a double click, or React asking twice in development): the lock on the
 * "viewed recently?" check makes the second wait for the first, and then find its view. Returns true when a view was recorded.
 */
async function recordView({ repairRequestId, garageUserId, gapMinutes = VIEW_GAP_MINUTES }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
    .input('garageUserId', sql.UniqueIdentifier, garageUserId)
    .input('gapMinutes', sql.Int, gapMinutes)
    .query(`
      INSERT INTO dbo.RepairRequestViews (RepairRequestId, GarageUserId)
      SELECT @repairRequestId, @garageUserId
      WHERE EXISTS (SELECT 1 FROM dbo.RepairRequests WHERE Id = @repairRequestId AND Status = 'open')
        AND NOT EXISTS (
          SELECT 1 FROM dbo.RepairRequestViews WITH (UPDLOCK, HOLDLOCK)
          WHERE GarageUserId = @garageUserId AND RepairRequestId = @repairRequestId
            AND ViewedAt > DATEADD(MINUTE, -@gapMinutes, SYSUTCDATETIME()))`);
  return result.rowsAffected[0] > 0;
}

module.exports = { recordView, VIEW_GAP_MINUTES };
