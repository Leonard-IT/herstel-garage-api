'use strict';

const sql = require('mssql');
const { getPool } = require('./db');
const { createToken } = require('./shareToken');

const LIST_LIMIT = 500;

// A link goes to a garage in the network (GarageId) or to a prospect, a garage we reach out to (ProspectId); exactly one of the two
// (migration 010). Both show up as a "recipient": { type: 'garage' | 'prospect', id, companyName, city }.
const RECIPIENT_JOINS = `
  LEFT JOIN dbo.Garages g ON g.Id = l.GarageId
  LEFT JOIN dbo.GarageProspects p ON p.Id = l.ProspectId`;
const RECIPIENT_COLUMNS = `
  CASE WHEN l.ProspectId IS NOT NULL THEN 'prospect' ELSE 'garage' END AS RecipientType,
  COALESCE(l.GarageId, l.ProspectId) AS RecipientId,
  COALESCE(g.CompanyName, p.CompanyName) AS RecipientName,
  COALESCE(g.City, p.City) AS RecipientCity`;
const toRecipient = (row) => ({ type: row.RecipientType, id: row.RecipientId, companyName: row.RecipientName, city: row.RecipientCity });

/** Approved garages, the ones in the network a link can be made for. */
async function listApprovedGarages() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT Id, CompanyName, City FROM dbo.Garages WHERE Status = 'approved' ORDER BY CompanyName`);
  return result.recordset.map((row) => ({ id: row.Id, companyName: row.CompanyName, city: row.City }));
}

/** Numbered parameters for an IN (...) list: { names: '@g0, @g1', bind(request) }. */
function inList(prefix, values, type) {
  return {
    names: values.map((_, i) => `@${prefix}${i}`).join(', '),
    bind: (request) => values.forEach((value, i) => request.input(`${prefix}${i}`, type, value)),
  };
}

/** The rows of the given ids that may get a link, by lowercase id. `query` selects Id, CompanyName, City WHERE ... AND Id IN (<list>). */
async function findRecipients(tx, prefix, ids, query) {
  if (!ids.length) return new Map();
  const list = inList(prefix, ids, sql.UniqueIdentifier);
  const request = new sql.Request(tx);
  list.bind(request);
  const result = await request.query(query(list.names));
  return new Map(result.recordset.map((row) => [String(row.Id).toLowerCase(), row]));
}

/**
 * Makes a link to a repair request for each of the garages and prospects.
 *
 * Garages must be approved (in the network); prospects must not have signed up yet (then they are a garage, and get a garage link).
 * Returns { notFound: true } when the request does not exist or is no longer open, { unknownGarageIds, unknownProspectIds } when one of
 * them cannot get a link (nothing is made then), or { links }. A recipient that already has a running link for this request (not
 * revoked, not expired) gets that link back with `existing: true` instead of a second one, so clicking twice does not make doubles.
 * A prospect that gets its first link goes from 'new' to 'contacted'.
 */
async function createLinks({ repairRequestId, garageIds = [], prospectIds = [], expiresInDays, createdBy, newToken = createToken }) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Lock the request while the links are made, so two people sharing it at once do not make doubles.
    const open = await new sql.Request(tx)
      .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
      .query("SELECT Id FROM dbo.RepairRequests WITH (UPDLOCK, HOLDLOCK) WHERE Id = @repairRequestId AND Status = 'open'");
    if (!open.recordset.length) {
      await tx.rollback();
      return { notFound: true };
    }

    const garages = await findRecipients(tx, 'g', garageIds, (names) =>
      `SELECT Id, CompanyName, City FROM dbo.Garages WHERE Status = 'approved' AND Id IN (${names})`);
    const prospects = await findRecipients(tx, 'p', prospectIds, (names) =>
      `SELECT Id, CompanyName, City FROM dbo.GarageProspects WHERE GarageId IS NULL AND Status <> 'registered' AND Id IN (${names})`);
    const unknownGarageIds = garageIds.filter((id) => !garages.has(id.toLowerCase()));
    const unknownProspectIds = prospectIds.filter((id) => !prospects.has(id.toLowerCase()));
    if (unknownGarageIds.length || unknownProspectIds.length) {
      await tx.rollback();
      return { unknownGarageIds, unknownProspectIds };
    }

    const existingRows = await new sql.Request(tx).input('repairRequestId', sql.UniqueIdentifier, repairRequestId).query(`
      SELECT Id, GarageId, ProspectId, Token, CreatedAt, ExpiresAt FROM dbo.RepairRequestShareLinks WITH (UPDLOCK)
      WHERE RepairRequestId = @repairRequestId AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()`);
    const existing = new Map(
      existingRows.recordset.map((row) => [
        row.ProspectId ? `prospect:${String(row.ProspectId).toLowerCase()}` : `garage:${String(row.GarageId).toLowerCase()}`,
        row,
      ]),
    );

    const recipients = [
      ...garageIds.map((id) => ({ type: 'garage', id, row: garages.get(id.toLowerCase()) })),
      ...prospectIds.map((id) => ({ type: 'prospect', id, row: prospects.get(id.toLowerCase()) })),
    ];
    const links = [];
    for (const recipient of recipients) {
      let row = existing.get(`${recipient.type}:${recipient.id.toLowerCase()}`);
      const isExisting = Boolean(row);
      if (!row) {
        const inserted = await new sql.Request(tx)
          .input('repairRequestId', sql.UniqueIdentifier, repairRequestId)
          .input('garageId', sql.UniqueIdentifier, recipient.type === 'garage' ? recipient.id : null)
          .input('prospectId', sql.UniqueIdentifier, recipient.type === 'prospect' ? recipient.id : null)
          .input('token', sql.Char(43), newToken())
          .input('createdBy', sql.VarChar(100), createdBy)
          .input('days', sql.Int, expiresInDays)
          .query(`INSERT INTO dbo.RepairRequestShareLinks (RepairRequestId, GarageId, ProspectId, Token, CreatedBy, ExpiresAt)
                  OUTPUT inserted.Id, inserted.Token, inserted.CreatedAt, inserted.ExpiresAt
                  VALUES (@repairRequestId, @garageId, @prospectId, @token, @createdBy, DATEADD(DAY, @days, SYSUTCDATETIME()))`);
        row = inserted.recordset[0];
      }
      links.push({
        id: row.Id,
        token: row.Token,
        repairRequestId,
        recipient: { type: recipient.type, id: recipient.row.Id, companyName: recipient.row.CompanyName, city: recipient.row.City },
        createdAt: row.CreatedAt.toISOString(),
        expiresAt: row.ExpiresAt.toISOString(),
        existing: isExisting,
      });
    }

    if (prospectIds.length) {
      const list = inList('c', prospectIds, sql.UniqueIdentifier);
      const request = new sql.Request(tx);
      list.bind(request);
      await request.query(`UPDATE dbo.GarageProspects SET Status = 'contacted' WHERE Status = 'new' AND Id IN (${list.names})`);
    }

    await tx.commit();
    return { links };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** revoked, expired or active. */
function linkStatus({ RevokedAt, ExpiresAt }, now = new Date()) {
  if (RevokedAt) return 'revoked';
  return ExpiresAt <= now ? 'expired' : 'active';
}

/**
 * Numbers for the top of the page, from one row of totals: all links, how many were opened at least once, the share that is, and the
 * average time between making a link and its first open (seconds, only over links that were opened).
 */
function buildStats(row) {
  const total = row.Total ?? 0;
  const opened = row.Opened ?? 0;
  return {
    totalLinks: total,
    openedLinks: opened,
    openRate: total > 0 ? opened / total : null,
    averageSecondsToOpen: opened > 0 && row.AverageSecondsToOpen != null ? Math.round(row.AverageSecondsToOpen) : null,
  };
}

const iso = (date) => (date ? date.toISOString() : null);

/** The newest links with their open and click status, and the totals over all links. */
async function listLinks(now = new Date()) {
  const pool = await getPool();
  const stats = await pool.request().query(`
    SELECT COUNT(*) AS Total,
           SUM(CASE WHEN FirstOpenedAt IS NOT NULL THEN 1 ELSE 0 END) AS Opened,
           AVG(CASE WHEN FirstOpenedAt IS NOT NULL THEN CAST(DATEDIFF(SECOND, CreatedAt, FirstOpenedAt) AS float) END) AS AverageSecondsToOpen
    FROM dbo.RepairRequestShareLinks`);
  const rows = await pool.request().input('limit', sql.Int, LIST_LIMIT).query(`
    SELECT TOP (@limit) l.Id, l.Token, l.CreatedAt, l.ExpiresAt, l.RevokedAt, l.FirstOpenedAt, l.LastOpenedAt, l.OpenCount,
           l.FirstPreviewAt, l.PreviewCount, l.FirstClickedAt, l.ClickCount, ${RECIPIENT_COLUMNS},
           rr.Id AS RequestId, rr.Status AS RequestStatus, rr.PostalCode, dr.DamageType, c.Make, c.Model
    FROM dbo.RepairRequestShareLinks l
    ${RECIPIENT_JOINS}
    JOIN dbo.RepairRequests rr ON rr.Id = l.RepairRequestId
    JOIN dbo.DamageReports dr ON dr.Id = rr.DamageReportId
    JOIN dbo.Cars c ON c.Id = dr.CarId
    ORDER BY l.CreatedAt DESC`);

  return {
    stats: buildStats(stats.recordset[0]),
    links: rows.recordset.map((row) => ({
      id: row.Id,
      token: row.Token,
      status: linkStatus(row, now),
      createdAt: iso(row.CreatedAt),
      expiresAt: iso(row.ExpiresAt),
      revokedAt: iso(row.RevokedAt),
      firstOpenedAt: iso(row.FirstOpenedAt),
      lastOpenedAt: iso(row.LastOpenedAt),
      openCount: row.OpenCount,
      firstPreviewAt: iso(row.FirstPreviewAt),
      previewCount: row.PreviewCount,
      firstClickedAt: iso(row.FirstClickedAt),
      clickCount: row.ClickCount,
      recipient: toRecipient(row),
      repairRequest: {
        id: row.RequestId,
        status: row.RequestStatus,
        car: `${row.Make} ${row.Model}`,
        damageType: row.DamageType,
        postalArea: row.PostalCode ? row.PostalCode.slice(0, 4) : null,
      },
    })),
  };
}

/** Revokes a link: it stops working at once. Returns false when there is no such link. */
async function revokeLink(id) {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, id)
    .query('UPDATE dbo.RepairRequestShareLinks SET RevokedAt = COALESCE(RevokedAt, SYSUTCDATETIME()) WHERE Id = @id');
  return result.rowsAffected[0] > 0;
}

/**
 * What the public page may show for a token, or null when the link does not work (unknown, expired, revoked, or the request is no
 * longer open). Only a few details about the request; never contact details, a license plate or the customer's own description.
 * `recipientType` says whether the link went to a garage in the network or to a prospect, which decides where the button leads.
 */
async function getPublicView(token, now = new Date()) {
  const pool = await getPool();
  const result = await pool.request().input('token', sql.Char(43), token).query(`
    SELECT l.Id AS LinkId, l.ExpiresAt, l.RevokedAt,
           CASE WHEN l.ProspectId IS NOT NULL THEN 'prospect' ELSE 'garage' END AS RecipientType,
           rr.Id AS RequestId, rr.Status, rr.PostalCode, rr.CreatedAt,
           dr.Id AS DamageReportId, dr.DamageType, dr.DamageLocation,
           c.Make, c.Model, c.BuildYear
    FROM dbo.RepairRequestShareLinks l
    JOIN dbo.RepairRequests rr ON rr.Id = l.RepairRequestId
    JOIN dbo.DamageReports dr ON dr.Id = rr.DamageReportId
    JOIN dbo.Cars c ON c.Id = dr.CarId
    WHERE l.Token = @token`);
  const row = result.recordset[0];
  if (!row || row.RevokedAt || row.ExpiresAt <= now || row.Status !== 'open') return null;

  const images = await pool.request().input('damageReportId', sql.UniqueIdentifier, row.DamageReportId).query(`
    SELECT BlobPath, ContentType FROM dbo.DamageReportImages WHERE DamageReportId = @damageReportId ORDER BY SortOrder`);
  return {
    linkId: row.LinkId,
    requestId: row.RequestId,
    recipientType: row.RecipientType,
    createdAt: row.CreatedAt,
    car: { make: row.Make, model: row.Model, buildYear: row.BuildYear },
    damageType: row.DamageType,
    location: row.DamageLocation,
    postalArea: row.PostalCode ? row.PostalCode.slice(0, 4) : null,
    images: images.recordset.map((image) => ({ blobPath: image.BlobPath, contentType: image.ContentType })),
  };
}

/**
 * Records that the page was fetched. A person counts as an open (first and last time, and how often); a link previewer (a chat app
 * building its preview) counts as a preview and never as an open. One statement, so it is correct when several fetches arrive at once.
 */
async function recordView(linkId, { preview }) {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, linkId).input('preview', sql.Bit, preview ? 1 : 0).query(`
    UPDATE dbo.RepairRequestShareLinks SET
      OpenCount      = OpenCount + CASE WHEN @preview = 0 THEN 1 ELSE 0 END,
      FirstOpenedAt  = CASE WHEN @preview = 0 AND FirstOpenedAt IS NULL THEN SYSUTCDATETIME() ELSE FirstOpenedAt END,
      LastOpenedAt   = CASE WHEN @preview = 0 THEN SYSUTCDATETIME() ELSE LastOpenedAt END,
      PreviewCount   = PreviewCount + CASE WHEN @preview = 1 THEN 1 ELSE 0 END,
      FirstPreviewAt = CASE WHEN @preview = 1 AND FirstPreviewAt IS NULL THEN SYSUTCDATETIME() ELSE FirstPreviewAt END
    WHERE Id = @id`);
}

/** Records a click on the page's button (people only; the caller leaves out link previewers and test clicks). */
async function recordClick(linkId) {
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, linkId).query(`
    UPDATE dbo.RepairRequestShareLinks SET
      ClickCount     = ClickCount + 1,
      FirstClickedAt = COALESCE(FirstClickedAt, SYSUTCDATETIME()),
      LastClickedAt  = SYSUTCDATETIME()
    WHERE Id = @id`);
}

module.exports = {
  listApprovedGarages,
  createLinks,
  listLinks,
  revokeLink,
  getPublicView,
  recordView,
  recordClick,
  buildStats,
  linkStatus,
};
