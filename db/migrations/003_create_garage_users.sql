-- Links a login (Microsoft Entra External ID user) to the garage they work for.
-- ExternalId is the user's object id (the "oid" claim; App Service Authentication passes it as x-ms-client-principal-id).
-- Rows are added manually or by a future invite flow, e.g.:
--   INSERT INTO dbo.GarageUsers (GarageId, ExternalId, Email) VALUES ('<garage id>', '<entra object id>', 'jan@example.nl');
CREATE TABLE dbo.GarageUsers (
    Id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_GarageUsers_Id DEFAULT NEWSEQUENTIALID(),
    GarageId   UNIQUEIDENTIFIER NOT NULL,
    ExternalId VARCHAR(100)     NOT NULL,
    Email      NVARCHAR(254)    NULL,
    CreatedAt  DATETIME2(0)     NOT NULL CONSTRAINT DF_GarageUsers_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_GarageUsers PRIMARY KEY (Id),
    CONSTRAINT FK_GarageUsers_Garages FOREIGN KEY (GarageId) REFERENCES dbo.Garages (Id),
    CONSTRAINT UQ_GarageUsers_ExternalId UNIQUE (ExternalId)
);
GO

CREATE INDEX IX_GarageUsers_GarageId ON dbo.GarageUsers (GarageId);
GO
