'use strict';

const sql = require('mssql');
const { getPool } = require('./db');

const DUPLICATE_KEY_ERRORS = [2601, 2627];
const LIST_LIMIT = 1000;

const toProspect = (row) => ({
  id: row.Id,
  companyName: row.CompanyName,
  city: row.City,
  street: row.Street,
  postalCode: row.PostalCode,
  phone: row.Phone,
  email: row.Email,
  website: row.Website,
  kvkNumber: row.KvkNumber,
  notes: row.Notes,
  status: row.Status,
  garageId: row.GarageId,
  createdAt: row.CreatedAt.toISOString(),
  linkCount: row.LinkCount ?? 0,
});

const COLUMNS = `p.Id, p.CompanyName, p.City, p.Street, p.PostalCode, p.Phone, p.Email, p.Website, p.KvkNumber, p.Notes, p.Status,
  p.GarageId, p.CreatedAt, (SELECT COUNT(*) FROM dbo.RepairRequestShareLinks l WHERE l.ProspectId = p.Id) AS LinkCount`;

/** All prospects, by name, with how many links were made for each. */
async function listProspects() {
  const pool = await getPool();
  const result = await pool.request().input('limit', sql.Int, LIST_LIMIT)
    .query(`SELECT TOP (@limit) ${COLUMNS} FROM dbo.GarageProspects p ORDER BY p.CompanyName`);
  return result.recordset.map(toProspect);
}

/** Adds a prospect. A KvK number that another prospect already has throws an error with statusCode 409. */
async function createProspect(prospect, createdBy) {
  const pool = await getPool();
  try {
    const result = await pool.request()
      .input('companyName', sql.NVarChar(200), prospect.companyName)
      .input('city', sql.NVarChar(100), prospect.city)
      .input('street', sql.NVarChar(200), prospect.street)
      .input('postalCode', sql.Char(6), prospect.postalCode)
      .input('phone', sql.NVarChar(30), prospect.phone)
      .input('email', sql.NVarChar(254), prospect.email)
      .input('website', sql.NVarChar(500), prospect.website)
      .input('kvkNumber', sql.Char(8), prospect.kvkNumber)
      .input('notes', sql.NVarChar(2000), prospect.notes)
      .input('createdBy', sql.VarChar(100), createdBy)
      .query(`
        INSERT INTO dbo.GarageProspects (CompanyName, City, Street, PostalCode, Phone, Email, Website, KvkNumber, Notes, CreatedBy)
        OUTPUT inserted.Id
        VALUES (@companyName, @city, @street, @postalCode, @phone, @email, @website, @kvkNumber, @notes, @createdBy)`);
    const id = result.recordset[0].Id;
    const created = await pool.request().input('id', sql.UniqueIdentifier, id)
      .query(`SELECT ${COLUMNS} FROM dbo.GarageProspects p WHERE p.Id = @id`);
    return toProspect(created.recordset[0]);
  } catch (err) {
    if (DUPLICATE_KEY_ERRORS.includes(err.number)) err.statusCode = 409;
    throw err;
  }
}

module.exports = { listProspects, createProspect, toProspect };
