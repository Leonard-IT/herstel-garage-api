-- Garage specializations and accreditations become maintainable lookup tables, the same setup as CustomerRepairPreferences:
-- a fixed list of options (Specializations, Accreditations) and a many-to-many pivot between garages and those options.
-- Slug is the stable key used by the API and the sign-up form. The slugs are the codes the pivots stored until now, so existing rows
-- convert one to one. The pivots are converted in place: Code is replaced by an Id that references the lookup table.
-- Each statement that uses a column or table created above is its own batch (GO), see 011.

CREATE TABLE dbo.Specializations (
    Id        INT IDENTITY(1, 1) NOT NULL,
    Slug      VARCHAR(50)        NOT NULL,
    Name      NVARCHAR(100)      NOT NULL,
    SortOrder INT                NOT NULL CONSTRAINT DF_Specializations_SortOrder DEFAULT 0,
    IsActive  BIT                NOT NULL CONSTRAINT DF_Specializations_IsActive DEFAULT 1,
    CONSTRAINT PK_Specializations PRIMARY KEY (Id),
    CONSTRAINT UQ_Specializations_Slug UNIQUE (Slug)
);
GO

CREATE TABLE dbo.Accreditations (
    Id        INT IDENTITY(1, 1) NOT NULL,
    Slug      VARCHAR(50)        NOT NULL,
    Name      NVARCHAR(100)      NOT NULL,
    SortOrder INT                NOT NULL CONSTRAINT DF_Accreditations_SortOrder DEFAULT 0,
    IsActive  BIT                NOT NULL CONSTRAINT DF_Accreditations_IsActive DEFAULT 1,
    CONSTRAINT PK_Accreditations PRIMARY KEY (Id),
    CONSTRAINT UQ_Accreditations_Slug UNIQUE (Slug)
);
GO

-- The options of the sign-up form (aanmelden-garage.html).
INSERT INTO dbo.Specializations (Slug, Name, SortOrder) VALUES
    ('lakschade',   N'Lakschade', 10),
    ('carrosserie', N'Carrosserieschade', 20),
    ('ruitschade',  N'Ruitschade', 30),
    ('bumper',      N'Bumper- en kunststofschade', 40),
    ('ev',          N'Elektrisch / hybride (EV)', 50),
    ('oldtimers',   N'Oldtimers / klassiekers', 60),
    ('overig',      N'Overig', 70);
GO

INSERT INTO dbo.Accreditations (Slug, Name, SortOrder) VALUES
    ('rdw',   N'RDW-erkenning', 10),
    ('focwa', N'Focwa-lid', 20),
    ('bovag', N'Bovag-lid', 30),
    ('iso',   N'ISO-gecertificeerd', 40);
GO

-- GarageSpecializations: (GarageId, Code) -> (GarageId, SpecializationId)
ALTER TABLE dbo.GarageSpecializations ADD SpecializationId INT NULL;
GO

UPDATE gs SET SpecializationId = s.Id
FROM dbo.GarageSpecializations gs
JOIN dbo.Specializations s ON s.Slug = gs.Code;
GO

ALTER TABLE dbo.GarageSpecializations DROP CONSTRAINT PK_GarageSpecializations;
GO

ALTER TABLE dbo.GarageSpecializations DROP COLUMN Code;
GO

-- Fails (and so stops the migration) when a stored code has no matching option.
ALTER TABLE dbo.GarageSpecializations ALTER COLUMN SpecializationId INT NOT NULL;
GO

ALTER TABLE dbo.GarageSpecializations ADD
    CONSTRAINT PK_GarageSpecializations PRIMARY KEY (GarageId, SpecializationId),
    CONSTRAINT FK_GarageSpecializations_Specializations FOREIGN KEY (SpecializationId) REFERENCES dbo.Specializations (Id);
GO

-- GarageAccreditations: (GarageId, Code) -> (GarageId, AccreditationId)
ALTER TABLE dbo.GarageAccreditations ADD AccreditationId INT NULL;
GO

UPDATE ga SET AccreditationId = a.Id
FROM dbo.GarageAccreditations ga
JOIN dbo.Accreditations a ON a.Slug = ga.Code;
GO

ALTER TABLE dbo.GarageAccreditations DROP CONSTRAINT PK_GarageAccreditations;
GO

ALTER TABLE dbo.GarageAccreditations DROP COLUMN Code;
GO

ALTER TABLE dbo.GarageAccreditations ALTER COLUMN AccreditationId INT NOT NULL;
GO

ALTER TABLE dbo.GarageAccreditations ADD
    CONSTRAINT PK_GarageAccreditations PRIMARY KEY (GarageId, AccreditationId),
    CONSTRAINT FK_GarageAccreditations_Accreditations FOREIGN KEY (AccreditationId) REFERENCES dbo.Accreditations (Id);
GO
