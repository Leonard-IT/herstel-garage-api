CREATE TABLE dbo.Garages (
    Id                    UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Garages_Id DEFAULT NEWSEQUENTIALID(),
    CompanyName           NVARCHAR(200)    NOT NULL,
    KvkNumber             CHAR(8)          NOT NULL,
    VatNumber             VARCHAR(14)      NULL,
    Street                NVARCHAR(200)    NOT NULL,
    PostalCode            CHAR(6)          NOT NULL,
    City                  NVARCHAR(100)    NOT NULL,
    Website               NVARCHAR(500)    NULL,
    ContactFirstName      NVARCHAR(100)    NOT NULL,
    ContactLastName       NVARCHAR(100)    NOT NULL,
    ContactJobTitle       NVARCHAR(100)    NULL,
    ContactEmail          NVARCHAR(254)    NOT NULL,
    ContactPhone          NVARCHAR(30)     NOT NULL,
    ServiceArea           NVARCHAR(500)    NOT NULL,
    EmployeeCount         VARCHAR(10)      NULL,
    LiftCount             INT              NULL,
    HasLiabilityInsurance BIT              NOT NULL,
    Iban                  VARCHAR(34)      NOT NULL,
    AcceptedTermsAt       DATETIME2(0)     NOT NULL,
    NewsletterOptIn       BIT              NOT NULL CONSTRAINT DF_Garages_Newsletter DEFAULT 0,
    Status                VARCHAR(20)      NOT NULL CONSTRAINT DF_Garages_Status DEFAULT 'pending',
    RegisteredAt          DATETIME2(0)     NOT NULL CONSTRAINT DF_Garages_RegisteredAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Garages PRIMARY KEY (Id),
    CONSTRAINT UQ_Garages_KvkNumber UNIQUE (KvkNumber),
    CONSTRAINT CK_Garages_Status CHECK (Status IN ('pending', 'approved', 'rejected', 'suspended')),
    CONSTRAINT CK_Garages_EmployeeCount CHECK (EmployeeCount IS NULL OR EmployeeCount IN ('1-5', '6-15', '16-30', '30+')),
    CONSTRAINT CK_Garages_LiftCount CHECK (LiftCount IS NULL OR LiftCount >= 0)
);
GO

CREATE INDEX IX_Garages_Status ON dbo.Garages (Status, RegisteredAt);
GO

CREATE TABLE dbo.GarageSpecializations (
    GarageId UNIQUEIDENTIFIER NOT NULL,
    Code     VARCHAR(30)      NOT NULL,
    CONSTRAINT PK_GarageSpecializations PRIMARY KEY (GarageId, Code),
    CONSTRAINT FK_GarageSpecializations_Garages FOREIGN KEY (GarageId) REFERENCES dbo.Garages (Id) ON DELETE CASCADE
);
GO

CREATE TABLE dbo.GarageAccreditations (
    GarageId UNIQUEIDENTIFIER NOT NULL,
    Code     VARCHAR(30)      NOT NULL,
    CONSTRAINT PK_GarageAccreditations PRIMARY KEY (GarageId, Code),
    CONSTRAINT FK_GarageAccreditations_Garages FOREIGN KEY (GarageId) REFERENCES dbo.Garages (Id) ON DELETE CASCADE
);
GO
