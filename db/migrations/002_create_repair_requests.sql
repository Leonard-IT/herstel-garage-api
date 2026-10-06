CREATE TABLE dbo.Customers (
    Id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Customers_Id DEFAULT NEWSEQUENTIALID(),
    FirstName NVARCHAR(100)    NOT NULL,
    LastName  NVARCHAR(100)    NOT NULL,
    Email     NVARCHAR(254)    NOT NULL,
    Phone     NVARCHAR(30)     NOT NULL,
    CreatedAt DATETIME2(0)     NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Customers PRIMARY KEY (Id),
    CONSTRAINT UQ_Customers_Email UNIQUE (Email)
);
GO

-- A car exists independently of its owner; ownership is tracked in CarOwnerships.
CREATE TABLE dbo.Cars (
    Id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Cars_Id DEFAULT NEWSEQUENTIALID(),
    LicensePlate CHAR(6)          NOT NULL,
    Make         NVARCHAR(100)    NOT NULL,
    Model        NVARCHAR(100)    NOT NULL,
    BuildYear    SMALLINT         NULL,
    CreatedAt    DATETIME2(0)     NOT NULL CONSTRAINT DF_Cars_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Cars PRIMARY KEY (Id),
    CONSTRAINT UQ_Cars_LicensePlate UNIQUE (LicensePlate),
    CONSTRAINT CK_Cars_BuildYear CHECK (BuildYear IS NULL OR BuildYear BETWEEN 1900 AND 2100)
);
GO

-- Ownership history: OwnedUntil IS NULL marks the current owner.
CREATE TABLE dbo.CarOwnerships (
    Id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_CarOwnerships_Id DEFAULT NEWSEQUENTIALID(),
    CarId      UNIQUEIDENTIFIER NOT NULL,
    CustomerId UNIQUEIDENTIFIER NOT NULL,
    OwnedFrom  DATETIME2(0)     NOT NULL CONSTRAINT DF_CarOwnerships_OwnedFrom DEFAULT SYSUTCDATETIME(),
    OwnedUntil DATETIME2(0)     NULL,
    CONSTRAINT PK_CarOwnerships PRIMARY KEY (Id),
    CONSTRAINT FK_CarOwnerships_Cars FOREIGN KEY (CarId) REFERENCES dbo.Cars (Id),
    CONSTRAINT FK_CarOwnerships_Customers FOREIGN KEY (CustomerId) REFERENCES dbo.Customers (Id),
    CONSTRAINT CK_CarOwnerships_Period CHECK (OwnedUntil IS NULL OR OwnedUntil >= OwnedFrom)
);
GO

-- At most one current owner per car.
CREATE UNIQUE INDEX UX_CarOwnerships_CurrentOwner ON dbo.CarOwnerships (CarId) WHERE OwnedUntil IS NULL;
GO

CREATE INDEX IX_CarOwnerships_CustomerId ON dbo.CarOwnerships (CustomerId);
GO

-- Facts about one damage: which car, what is damaged, photos. No customer wishes, no garage.
CREATE TABLE dbo.DamageReports (
    Id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_DamageReports_Id DEFAULT NEWSEQUENTIALID(),
    CarId          UNIQUEIDENTIFIER NOT NULL,
    Description    NVARCHAR(2000)   NOT NULL,
    DamageLocation VARCHAR(30)      NULL,
    CreatedAt      DATETIME2(0)     NOT NULL CONSTRAINT DF_DamageReports_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DamageReports PRIMARY KEY (Id),
    CONSTRAINT FK_DamageReports_Cars FOREIGN KEY (CarId) REFERENCES dbo.Cars (Id)
);
GO

CREATE INDEX IX_DamageReports_CarId ON dbo.DamageReports (CarId);
GO

-- Images live in Azure Blob Storage (container "damage-images"); only the blob path is stored here.
CREATE TABLE dbo.DamageReportImages (
    Id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_DamageReportImages_Id DEFAULT NEWSEQUENTIALID(),
    DamageReportId UNIQUEIDENTIFIER NOT NULL,
    BlobPath       NVARCHAR(500)    NOT NULL,
    ContentType    VARCHAR(100)     NOT NULL,
    SizeBytes      BIGINT           NOT NULL,
    SortOrder      INT              NOT NULL,
    CreatedAt      DATETIME2(0)     NOT NULL CONSTRAINT DF_DamageReportImages_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DamageReportImages PRIMARY KEY (Id),
    CONSTRAINT FK_DamageReportImages_DamageReports FOREIGN KEY (DamageReportId) REFERENCES dbo.DamageReports (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_DamageReportImages_BlobPath UNIQUE (BlobPath)
);
GO

CREATE INDEX IX_DamageReportImages_DamageReportId ON dbo.DamageReportImages (DamageReportId, SortOrder);
GO

-- A customer asking for repair of one damage. CustomerId is the customer at submission time, which may differ
-- from the car's current owner later on.
CREATE TABLE dbo.RepairRequests (
    Id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RepairRequests_Id DEFAULT NEWSEQUENTIALID(),
    DamageReportId UNIQUEIDENTIFIER NOT NULL,
    CustomerId     UNIQUEIDENTIFIER NOT NULL,
    Status         VARCHAR(20)      NOT NULL CONSTRAINT DF_RepairRequests_Status DEFAULT 'open',
    CreatedAt      DATETIME2(0)     NOT NULL CONSTRAINT DF_RepairRequests_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RepairRequests PRIMARY KEY (Id),
    CONSTRAINT FK_RepairRequests_DamageReports FOREIGN KEY (DamageReportId) REFERENCES dbo.DamageReports (Id),
    CONSTRAINT FK_RepairRequests_Customers FOREIGN KEY (CustomerId) REFERENCES dbo.Customers (Id),
    CONSTRAINT CK_RepairRequests_Status CHECK (Status IN ('open', 'in_progress', 'completed', 'cancelled'))
);
GO

CREATE INDEX IX_RepairRequests_Status ON dbo.RepairRequests (Status, CreatedAt);
GO

CREATE INDEX IX_RepairRequests_DamageReportId ON dbo.RepairRequests (DamageReportId);
GO

CREATE INDEX IX_RepairRequests_CustomerId ON dbo.RepairRequests (CustomerId);
GO

-- Maintainable list of options a customer can choose from. Slug is the stable English key used by the API.
CREATE TABLE dbo.CustomerRepairPreferences (
    Id        INT IDENTITY(1, 1) NOT NULL,
    Slug      VARCHAR(50)        NOT NULL,
    Name      NVARCHAR(100)      NOT NULL,
    SortOrder INT                NOT NULL CONSTRAINT DF_CustomerRepairPreferences_SortOrder DEFAULT 0,
    IsActive  BIT                NOT NULL CONSTRAINT DF_CustomerRepairPreferences_IsActive DEFAULT 1,
    CONSTRAINT PK_CustomerRepairPreferences PRIMARY KEY (Id),
    CONSTRAINT UQ_CustomerRepairPreferences_Slug UNIQUE (Slug)
);
GO

CREATE TABLE dbo.RepairRequestPreferences (
    RepairRequestId UNIQUEIDENTIFIER NOT NULL,
    PreferenceId    INT              NOT NULL,
    CONSTRAINT PK_RepairRequestPreferences PRIMARY KEY (RepairRequestId, PreferenceId),
    CONSTRAINT FK_RepairRequestPreferences_RepairRequests FOREIGN KEY (RepairRequestId) REFERENCES dbo.RepairRequests (Id) ON DELETE CASCADE,
    CONSTRAINT FK_RepairRequestPreferences_Preferences FOREIGN KEY (PreferenceId) REFERENCES dbo.CustomerRepairPreferences (Id)
);
GO

INSERT INTO dbo.CustomerRepairPreferences (Slug, Name, SortOrder) VALUES
    ('rental-car',          N'Leenauto of vervangend vervoer', 10),
    ('pickup-and-delivery', N'Auto laten ophalen en terugbrengen', 20),
    ('repair-nearby',       N'Reparatie bij mij in de buurt', 30),
    ('fast-repair',         N'Zo snel mogelijk gerepareerd', 40),
    ('original-parts',      N'Originele onderdelen', 50),
    ('insurance-handling',  N'Afhandeling met mijn verzekeraar', 60),
    ('repair-estimate',     N'Eerst een offerte ontvangen', 70);
GO
