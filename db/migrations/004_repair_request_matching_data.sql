-- Data needed to match requests to garages and to make submissions safe to retry.
-- Each ALTER/UPDATE is its own batch (GO): SQL Server compiles a batch before running it, so a column added in the
-- same batch cannot be referenced yet.

-- 1. Damage type (same vocabulary as the garage specializations; validated in the API). Existing rows become 'overig'.
ALTER TABLE dbo.DamageReports ADD DamageType VARCHAR(30) NULL;
GO

UPDATE dbo.DamageReports SET DamageType = 'overig' WHERE DamageType IS NULL;
GO

ALTER TABLE dbo.DamageReports ALTER COLUMN DamageType VARCHAR(30) NOT NULL;
GO

-- 2. Where the repair should take place (postal code, 4 digits + 2 letters). NULL for requests created before this
--    migration. Garages only get to see the 4-digit area.
ALTER TABLE dbo.RepairRequests ADD PostalCode CHAR(6) NULL;
GO

-- 3. Contact details as submitted with this request. Customers is matched by email and never overwritten, so a returning
--    customer's new phone number would otherwise be lost.
ALTER TABLE dbo.RepairRequests ADD ContactFirstName NVARCHAR(100) NULL, ContactLastName NVARCHAR(100) NULL, ContactPhone NVARCHAR(30) NULL;
GO

UPDATE rr
SET ContactFirstName = c.FirstName, ContactLastName = c.LastName, ContactPhone = c.Phone
FROM dbo.RepairRequests rr
JOIN dbo.Customers c ON c.Id = rr.CustomerId;
GO

ALTER TABLE dbo.RepairRequests ALTER COLUMN ContactFirstName NVARCHAR(100) NOT NULL;
GO

ALTER TABLE dbo.RepairRequests ALTER COLUMN ContactLastName NVARCHAR(100) NOT NULL;
GO

ALTER TABLE dbo.RepairRequests ALTER COLUMN ContactPhone NVARCHAR(30) NOT NULL;
GO

-- 4. Idempotency: the browser generates one SubmissionId per form; a retry of the same submission (lost response,
--    double click) hits this index instead of creating duplicates. SubmissionIndex is the damage's position in the form.
ALTER TABLE dbo.RepairRequests ADD SubmissionId UNIQUEIDENTIFIER NULL, SubmissionIndex TINYINT NULL;
GO

CREATE UNIQUE INDEX UX_RepairRequests_Submission ON dbo.RepairRequests (SubmissionId, SubmissionIndex) WHERE SubmissionId IS NOT NULL;
GO
