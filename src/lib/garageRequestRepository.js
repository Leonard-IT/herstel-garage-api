'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

const LIST_LIMIT = 50;

// Deliberately selects no personal data: nothing from Customers and no license plate. A garage sees the car's make,
// model and year, the damage and the preferences; contact details come later, once a garage has taken the job.
const REQUEST_COLUMNS = `
  rr.Id, rr.CreatedAt, dr.Id AS DamageReportId, dr.Description, dr.DamageLocation,
  c.Make, c.Model, c.BuildYear`;
const REQUEST_JOINS = `
  FROM dbo.RepairRequests rr
  JOIN dbo.DamageReports dr ON dr.Id = rr.DamageReportId
  JOIN dbo.Cars c ON c.Id = dr.CarId`;

const toRequest = (row) => ({
  id: row.Id,
  damageReportId: row.DamageReportId,
  createdAt: row.CreatedAt.toISOString(),
  car: { make: row.Make, model: row.Model, buildYear: row.BuildYear },
  description: row.Description,
  location: row.DamageLocation,
});

async function loadPreferences(pool, whereClause, bind) {
  const request = bind(pool.request());
  const result = await request.query(`
    SELECT rp.RepairRequestId, p.Slug, p.Name
    FROM dbo.RepairRequestPreferences rp
    JOIN dbo.CustomerRepairPreferences p ON p.Id = rp.PreferenceId
    JOIN dbo.RepairRequests rr ON rr.Id = rp.RepairRequestId
    WHERE ${whereClause}
    ORDER BY p.SortOrder`);
  const byRequest = new Map();
  for (const row of result.recordset) {
    if (!byRequest.has(row.RepairRequestId)) byRequest.set(row.RepairRequestId, []);
    byRequest.get(row.RepairRequestId).push({ slug: row.Slug, name: row.Name });
  }
  return byRequest;
}

/** Newest open repair requests, each with its first image path and image count. */
async function listOpenRequests() {
  const pool = await getPool();
  const result = await pool.request().input('limit', sql.Int, LIST_LIMIT).query(`
    SELECT TOP (@limit) ${REQUEST_COLUMNS},
      (SELECT TOP 1 i.BlobPath FROM dbo.DamageReportImages i WHERE i.DamageReportId = dr.Id ORDER BY i.SortOrder) AS ThumbnailPath,
      (SELECT COUNT(*) FROM dbo.DamageReportImages i WHERE i.DamageReportId = dr.Id) AS ImageCount
    ${REQUEST_JOINS}
    WHERE rr.Status = 'open'
    ORDER BY rr.CreatedAt DESC`);
  const preferences = await loadPreferences(pool, "rr.Status = 'open'", (r) => r);
  return result.recordset.map((row) => ({
    ...toRequest(row),
    thumbnailPath: row.ThumbnailPath,
    imageCount: row.ImageCount,
    preferences: preferences.get(row.Id) ?? [],
  }));
}

/** One open repair request with all its image paths, or null when it does not exist or is no longer open. */
async function getOpenRequest(id) {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, id).query(`
    SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}
    WHERE rr.Id = @id AND rr.Status = 'open'`);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];

  const images = await pool.request().input('damageReportId', sql.UniqueIdentifier, row.DamageReportId).query(`
    SELECT BlobPath FROM dbo.DamageReportImages WHERE DamageReportId = @damageReportId ORDER BY SortOrder`);
  const preferences = await loadPreferences(pool, 'rr.Id = @id', (r) => r.input('id', sql.UniqueIdentifier, id));
  return {
    ...toRequest(row),
    imagePaths: images.recordset.map((r) => r.BlobPath),
    preferences: preferences.get(row.Id) ?? [],
  };
}

module.exports = { listOpenRequests, getOpenRequest };
