'use strict';

// Fills in the coordinates (migration 011) of garages and repair requests that have a postal code but no coordinates yet: rows from
// before the migration, and rows whose lookup failed at the time. Safe to run again; it only touches rows without coordinates.
// Usage: SQL_CONNECTION_STRING="..." node scripts/geocode-backfill.js   (reads local.settings.json if unset)

const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const { buildSqlConfig, connectWithRetry } = require('../src/lib/sqlConfig');
const { geocodePostalCode } = require('../src/lib/geocoder');

const TABLES = ['Garages', 'RepairRequests'];
const PAUSE_MS = 100; // be polite to a free public service

function connectionString() {
  if (process.env.SQL_CONNECTION_STRING) return process.env.SQL_CONNECTION_STRING;
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));
  return settings.Values.SQL_CONNECTION_STRING;
}

async function main() {
  const pool = await connectWithRetry(buildSqlConfig(connectionString()), { attempts: 4, timeoutMs: 60000, delayMs: 10000 });
  const found = new Map(); // postal code -> coordinates or null, so a postal code is looked up once per run

  for (const table of TABLES) {
    const rows = (await pool.request().query(
      `SELECT Id, PostalCode FROM dbo.${table} WHERE PostalCode IS NOT NULL AND Latitude IS NULL`,
    )).recordset;
    let filled = 0;
    let unknown = 0;
    let failed = 0;

    for (const row of rows) {
      const postalCode = row.PostalCode.trim();
      if (!found.has(postalCode)) {
        try {
          found.set(postalCode, await geocodePostalCode(postalCode));
        } catch (err) {
          failed += 1;
          console.warn(`${postalCode}: ${err.message}`);
          continue; // not remembered: a later row with the same postal code tries again
        }
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
      const coordinates = found.get(postalCode);
      if (!coordinates) {
        unknown += 1;
        continue;
      }
      await pool.request()
        .input('id', sql.UniqueIdentifier, row.Id)
        .input('latitude', sql.Decimal(9, 6), coordinates.latitude)
        .input('longitude', sql.Decimal(9, 6), coordinates.longitude)
        .query(`UPDATE dbo.${table} SET Latitude = @latitude, Longitude = @longitude WHERE Id = @id AND Latitude IS NULL`);
      filled += 1;
    }
    console.log(`${table}: ${rows.length} without coordinates, ${filled} filled in, ${unknown} postal codes unknown, ${failed} lookups failed`);
  }
  await pool.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
