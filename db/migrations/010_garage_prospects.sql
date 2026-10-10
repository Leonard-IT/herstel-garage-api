-- Garage prospects: garages that meet our criteria but are not in the network yet. We reach out to them with real repair requests (a
-- share link); to make an offer they sign up, and from then on they are a garage in dbo.Garages.
--
-- Prospects are kept apart from dbo.Garages on purpose. Garages holds sign-up data (KvK, IBAN, contact person, accepted terms), all
-- required; of a prospect we often only know a name, a place and a phone number. And everything that means "garages in our network"
-- (links, matching, logins, offers) reads dbo.Garages, so a prospect can never show up there by accident.
--
-- When a prospect signs up, GarageId points to its new garage and Status becomes 'registered'. Signing up through the link of an
-- invitation approves the garage straight away (we reached out to them; see registerGarage).

CREATE TABLE dbo.GarageProspects (
    Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_GarageProspects_Id DEFAULT NEWSEQUENTIALID(),
    CompanyName NVARCHAR(200)    NOT NULL,
    City        NVARCHAR(100)    NOT NULL,
    Street      NVARCHAR(200)    NULL,
    PostalCode  CHAR(6)          NULL,
    Phone       NVARCHAR(30)     NULL,
    Email       NVARCHAR(254)    NULL,
    Website     NVARCHAR(500)    NULL,
    -- When known: also used to recognise a prospect that signs up without the link.
    KvkNumber   CHAR(8)          NULL,
    Notes       NVARCHAR(2000)   NULL,
    Status      VARCHAR(20)      NOT NULL CONSTRAINT DF_GarageProspects_Status DEFAULT 'new',
    GarageId    UNIQUEIDENTIFIER NULL,
    CreatedBy   VARCHAR(100)     NULL,
    CreatedAt   DATETIME2(0)     NOT NULL CONSTRAINT DF_GarageProspects_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_GarageProspects PRIMARY KEY (Id),
    CONSTRAINT FK_GarageProspects_Garages FOREIGN KEY (GarageId) REFERENCES dbo.Garages (Id),
    CONSTRAINT CK_GarageProspects_Status CHECK (Status IN ('new', 'contacted', 'registered', 'not_interested'))
);
GO

CREATE UNIQUE INDEX UX_GarageProspects_KvkNumber ON dbo.GarageProspects (KvkNumber) WHERE KvkNumber IS NOT NULL;
GO

-- A garage comes from at most one prospect.
CREATE UNIQUE INDEX UX_GarageProspects_GarageId ON dbo.GarageProspects (GarageId) WHERE GarageId IS NOT NULL;
GO

-- Share links can now be made for a prospect as well as for a garage in the network: exactly one of GarageId and ProspectId is set.
-- Changing GarageId to NULL is only possible without the foreign key and the indexes on it, so those are dropped and made again.
ALTER TABLE dbo.RepairRequestShareLinks DROP CONSTRAINT FK_ShareLinks_Garages;
GO

DROP INDEX IX_ShareLinks_RepairRequestId ON dbo.RepairRequestShareLinks;
GO

DROP INDEX IX_ShareLinks_GarageId ON dbo.RepairRequestShareLinks;
GO

ALTER TABLE dbo.RepairRequestShareLinks ALTER COLUMN GarageId UNIQUEIDENTIFIER NULL;
GO

-- FirstClickedAt / LastClickedAt / ClickCount: the button on the public page ("Bekijk de aanvraag" / "Meld je aan"), counted like the
-- opens: people only, never link previewers, and not the admin's own test clicks.
ALTER TABLE dbo.RepairRequestShareLinks ADD
    ProspectId     UNIQUEIDENTIFIER NULL,
    FirstClickedAt DATETIME2(0)     NULL,
    LastClickedAt  DATETIME2(0)     NULL,
    ClickCount     INT              NOT NULL CONSTRAINT DF_ShareLinks_ClickCount DEFAULT 0;
GO

ALTER TABLE dbo.RepairRequestShareLinks ADD
    CONSTRAINT FK_ShareLinks_Garages FOREIGN KEY (GarageId) REFERENCES dbo.Garages (Id),
    CONSTRAINT FK_ShareLinks_GarageProspects FOREIGN KEY (ProspectId) REFERENCES dbo.GarageProspects (Id),
    CONSTRAINT CK_ShareLinks_Recipient CHECK (
        (GarageId IS NOT NULL AND ProspectId IS NULL) OR (GarageId IS NULL AND ProspectId IS NOT NULL));
GO

CREATE INDEX IX_ShareLinks_RepairRequestId ON dbo.RepairRequestShareLinks (RepairRequestId);
GO

CREATE INDEX IX_ShareLinks_GarageId ON dbo.RepairRequestShareLinks (GarageId) WHERE GarageId IS NOT NULL;
GO

CREATE INDEX IX_ShareLinks_ProspectId ON dbo.RepairRequestShareLinks (ProspectId) WHERE ProspectId IS NOT NULL;
GO
