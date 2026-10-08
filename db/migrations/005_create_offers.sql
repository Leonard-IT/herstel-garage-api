-- A garage's offer on a repair request: from which date it can do the repair, and how long the offer stays valid.
-- No price yet: the price model (price clock or garage quote) is still to be decided, see SUGGESTIONS.md.
CREATE TABLE dbo.Offers (
    Id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Offers_Id DEFAULT NEWSEQUENTIALID(),
    RepairRequestId UNIQUEIDENTIFIER NOT NULL,
    GarageId        UNIQUEIDENTIFIER NOT NULL,
    -- Who made the offer. Set to NULL when that login is removed, so the offer itself stays.
    CreatedByUserId UNIQUEIDENTIFIER NULL,
    AvailableFrom   DATE             NOT NULL,
    ValidityHours   SMALLINT         NOT NULL,
    -- CreatedAt + ValidityHours, computed once on the server when the offer is made.
    ExpiresAt       DATETIME2(0)     NOT NULL,
    Status          VARCHAR(20)      NOT NULL CONSTRAINT DF_Offers_Status DEFAULT 'active',
    CreatedAt       DATETIME2(0)     NOT NULL CONSTRAINT DF_Offers_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Offers PRIMARY KEY (Id),
    CONSTRAINT FK_Offers_RepairRequests FOREIGN KEY (RepairRequestId) REFERENCES dbo.RepairRequests (Id),
    CONSTRAINT FK_Offers_Garages FOREIGN KEY (GarageId) REFERENCES dbo.Garages (Id),
    CONSTRAINT FK_Offers_GarageUsers FOREIGN KEY (CreatedByUserId) REFERENCES dbo.GarageUsers (Id) ON DELETE SET NULL,
    CONSTRAINT CK_Offers_ValidityHours CHECK (ValidityHours IN (12, 24, 48)),
    CONSTRAINT CK_Offers_Status CHECK (Status IN ('active', 'accepted', 'declined', 'expired', 'withdrawn'))
);
GO

-- A garage can have at most one active offer per request. A new offer is only possible after the old one expired or was withdrawn.
CREATE UNIQUE INDEX UX_Offers_ActivePerGarageAndRequest ON dbo.Offers (RepairRequestId, GarageId) WHERE Status = 'active';
GO

CREATE INDEX IX_Offers_GarageId ON dbo.Offers (GarageId, CreatedAt);
GO

CREATE INDEX IX_Offers_RepairRequestId ON dbo.Offers (RepairRequestId, Status);
GO
