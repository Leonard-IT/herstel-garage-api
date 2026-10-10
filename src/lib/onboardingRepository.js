'use strict';

const sql = require('mssql');
const { getPool } = require('./db');
const { DAMAGE_TYPE_LABELS } = require('./sharePage');

const LIST_LIMIT = 2000;

// The onboarding funnel: every share link that went to a prospect, or to a garage that came from a prospect (its later invites), with
// one timestamp per step. Links to garages that joined without ever being a prospect are left out: they are not onboarding.
//
// One business keeps one id across its invites: the prospect's id, also after it signed up and became a garage. So a garage's first
// invite (as a prospect) and its later ones (as a garage) group together in the dashboard.
//
// Steps:
//   linkShared          the link was made
//   linkOpened          first opened by a person (not a link previewer, not the admin's own test)
//   viewRequestClicked  first click on the page's button (same rules)
//   registered          the garage signed up (Garages.RegisteredAt); the same for all its invites, also those after it signed up
//   requestViewed       first view of that request by a user of the garage after the link was made (RepairRequestViews; admins
//                       are never recorded there)
//   offerCreated        first offer by the garage on that request after the link was made
const QUERY = `
  SELECT TOP (@limit)
    l.Id, l.CreatedAt, l.FirstOpenedAt, l.FirstClickedAt,
    COALESCE(lp.Id, gp.Id) AS ProspectId,
    COALESCE(eg.CompanyName, lp.CompanyName) AS CompanyName,
    COALESCE(eg.City, lp.City) AS City,
    eg.RegisteredAt,
    c.Make, c.Model, dr.DamageType,
    (SELECT MIN(v.ViewedAt) FROM dbo.RepairRequestViews v JOIN dbo.GarageUsers u ON u.Id = v.GarageUserId
       WHERE v.RepairRequestId = l.RepairRequestId AND u.GarageId = eg.Id AND v.ViewedAt >= l.CreatedAt) AS FirstViewedAt,
    (SELECT MIN(o.CreatedAt) FROM dbo.Offers o
       WHERE o.RepairRequestId = l.RepairRequestId AND o.GarageId = eg.Id AND o.CreatedAt >= l.CreatedAt) AS FirstOfferAt
  FROM dbo.RepairRequestShareLinks l
  LEFT JOIN dbo.GarageProspects lp ON lp.Id = l.ProspectId            -- the link went to a prospect
  LEFT JOIN dbo.GarageProspects gp ON gp.GarageId = l.GarageId        -- the link went to a garage that came from a prospect
  LEFT JOIN dbo.Garages eg ON eg.Id = COALESCE(l.GarageId, lp.GarageId) -- the garage, once there is one
  JOIN dbo.RepairRequests rr ON rr.Id = l.RepairRequestId
  JOIN dbo.DamageReports dr ON dr.Id = rr.DamageReportId
  JOIN dbo.Cars c ON c.Id = dr.CarId
  WHERE lp.Id IS NOT NULL OR gp.Id IS NOT NULL
  ORDER BY l.CreatedAt DESC`;

const iso = (date) => (date ? date.toISOString() : null);

/** One row of QUERY as an invite, in the shape the dashboard's onboarding page works with (funnel.ts there). */
function toInvite(row) {
  const damage = DAMAGE_TYPE_LABELS[row.DamageType];
  return {
    id: row.Id,
    garageId: row.ProspectId,
    garageName: row.CompanyName,
    city: row.City,
    repairRequestTitle: `${row.Make} ${row.Model}${damage ? ` · ${damage.toLowerCase()}` : ''}`,
    events: {
      linkShared: iso(row.CreatedAt),
      linkOpened: iso(row.FirstOpenedAt),
      viewRequestClicked: iso(row.FirstClickedAt),
      registered: iso(row.RegisteredAt),
      requestViewed: iso(row.FirstViewedAt),
      offerCreated: iso(row.FirstOfferAt),
    },
  };
}

/** The invites of the onboarding funnel, newest first. */
async function listInvites() {
  const pool = await getPool();
  const result = await pool.request().input('limit', sql.Int, LIST_LIMIT).query(QUERY);
  return result.recordset.map(toInvite);
}

module.exports = { listInvites, toInvite };
