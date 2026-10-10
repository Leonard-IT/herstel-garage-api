# Database schema

Current state after migrations 001–004 (`db/migrations`). Azure SQL Database / SQL Server; keys are `UNIQUEIDENTIFIER`
with `NEWSEQUENTIALID()` unless noted. The diagram renders on GitHub and in VS Code (Markdown preview with Mermaid support).

```mermaid
erDiagram
    Garages ||--o{ GarageSpecializations : "offers"
    Garages ||--o{ GarageAccreditations : "holds"
    Garages ||--o{ GarageUsers : "has logins"

    Customers ||--o{ CarOwnerships : "owns (history)"
    Cars ||--o{ CarOwnerships : "owned by"
    Cars ||--o{ DamageReports : "has damages"
    DamageReports ||--o{ DamageReportImages : "shown in"
    DamageReports ||--o{ RepairRequests : "repair asked for"
    Customers ||--o{ RepairRequests : "submits"
    RepairRequests ||--o{ RepairRequestPreferences : "wishes"
    CustomerRepairPreferences ||--o{ RepairRequestPreferences : "chosen in"

    Garages {
        uuid Id PK
        nvarchar CompanyName
        char KvkNumber UK "8 digits"
        varchar VatNumber
        nvarchar Street
        char PostalCode
        decimal Latitude "of the postal code, null if unknown"
        decimal Longitude "of the postal code, null if unknown"
        nvarchar City
        nvarchar Website
        nvarchar ContactFirstName
        nvarchar ContactLastName
        nvarchar ContactJobTitle
        nvarchar ContactEmail
        nvarchar ContactPhone
        nvarchar ServiceArea "free text"
        varchar EmployeeCount
        int LiftCount
        bit HasLiabilityInsurance
        varchar Iban
        datetime2 AcceptedTermsAt
        bit NewsletterOptIn
        varchar Status "pending, approved, rejected, suspended"
        datetime2 RegisteredAt
    }

    GarageSpecializations {
        uuid GarageId PK, FK
        varchar Code PK "lakschade, ev, ..."
    }

    GarageAccreditations {
        uuid GarageId PK, FK
        varchar Code PK "rdw, bovag, ..."
    }

    GarageUsers {
        uuid Id PK
        uuid GarageId FK
        varchar ExternalId UK "Entra object id"
        nvarchar Email
        datetime2 CreatedAt
    }

    Customers {
        uuid Id PK
        nvarchar FirstName
        nvarchar LastName
        nvarchar Email UK
        nvarchar Phone
        datetime2 CreatedAt
    }

    Cars {
        uuid Id PK
        char LicensePlate UK "6 chars"
        nvarchar Make
        nvarchar Model
        smallint BuildYear
        datetime2 CreatedAt
    }

    CarOwnerships {
        uuid Id PK
        uuid CarId FK
        uuid CustomerId FK
        datetime2 OwnedFrom
        datetime2 OwnedUntil "NULL = current owner"
    }

    DamageReports {
        uuid Id PK
        uuid CarId FK
        nvarchar Description
        varchar DamageType "lakschade, carrosserie, ..."
        varchar DamageLocation "front, rear, ..."
        datetime2 CreatedAt
    }

    DamageReportImages {
        uuid Id PK
        uuid DamageReportId FK
        nvarchar BlobPath UK "blob in damage-images"
        varchar ContentType
        bigint SizeBytes
        int SortOrder
        datetime2 CreatedAt
    }

    RepairRequests {
        uuid Id PK
        uuid DamageReportId FK
        uuid CustomerId FK
        varchar Status "open, in_progress, completed, cancelled"
        char PostalCode "garages see first 4 digits"
        decimal Latitude "of the postal code; never shown, only a rounded distance"
        decimal Longitude "of the postal code; never shown, only a rounded distance"
        nvarchar ContactFirstName "as submitted"
        nvarchar ContactLastName "as submitted"
        nvarchar ContactPhone "as submitted"
        uuid SubmissionId UK "idempotency, with SubmissionIndex"
        tinyint SubmissionIndex
        datetime2 CreatedAt
    }

    CustomerRepairPreferences {
        int Id PK "identity"
        varchar Slug UK "english key"
        nvarchar Name "dutch label"
        int SortOrder
        bit IsActive
    }

    RepairRequestPreferences {
        uuid RepairRequestId PK, FK
        int PreferenceId PK, FK
    }
```

## Notes

- **Not in the diagram:** `dbo.SchemaMigrations` (bookkeeping for `npm run migrate`).
- **Garages and customers are separate worlds.** Garage-side tables (`Garages`, `GarageUsers`, ...) link to customer-side data only through
  `RepairRequests`, and only via the API, which exposes no `Customers` data and no license plate to garages.
- **Ownership is history, requests are snapshots.** `RepairRequests.CustomerId` is the customer at submission time (with the contact
  details typed on that request), while `CarOwnerships` tracks who owns the car over time (one current owner per car, enforced by a
  filtered unique index on `CarId WHERE OwnedUntil IS NULL`).
- **Images are not in the database.** `DamageReportImages.BlobPath` points to a blob in the private `damage-images` container.
- **Idempotent submissions.** `UX_RepairRequests_Submission` is a unique index on `(SubmissionId, SubmissionIndex)`; a retried submission
  returns the original requests.
- **Planned changes** (offers, status history, lookup tables, GDPR, ...) are listed in `TODO.md`.
