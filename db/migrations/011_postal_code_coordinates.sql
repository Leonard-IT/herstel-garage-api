-- Coordinates of the postal codes, so the distance between a garage and a repair request can be worked out without a network call.
-- They are looked up once, when the garage registers or the request is submitted (PDOK Locatieserver, see src/lib/geocoder.js).
-- WGS84 degrees, 6 decimals (about 10 cm; more than a postal code centroid deserves). NULL when the lookup failed or the row
-- predates this migration; scripts/geocode-backfill.js fills those in. The API treats NULL as "distance unknown".
-- Each ALTER is its own batch (GO): SQL Server compiles a batch before running it, so a column added in the same batch cannot be
-- referenced yet.

ALTER TABLE dbo.Garages ADD Latitude DECIMAL(9,6) NULL, Longitude DECIMAL(9,6) NULL;
GO

ALTER TABLE dbo.RepairRequests ADD Latitude DECIMAL(9,6) NULL, Longitude DECIMAL(9,6) NULL;
GO

-- Both or neither, and within the globe.
ALTER TABLE dbo.Garages ADD CONSTRAINT CK_Garages_Coordinates CHECK (
    (Latitude IS NULL AND Longitude IS NULL)
    OR (Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180));
GO

ALTER TABLE dbo.RepairRequests ADD CONSTRAINT CK_RepairRequests_Coordinates CHECK (
    (Latitude IS NULL AND Longitude IS NULL)
    OR (Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180));
GO
