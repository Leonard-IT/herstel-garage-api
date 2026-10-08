# herstel-garage-api

Azure Functions (Node.js, v4 programming model) backend for SnelHerstel.nl partner garages.
Registrations are stored in Azure SQL Database (SQL Server in Docker locally).

## Endpoints

### `POST /api/garages/register`

Registers a garage (status `pending`, awaiting verification). The KvK number is the unique key.

```json
{
  "companyName": "Garage Test B.V.",
  "kvkNumber": "12345678",
  "vatNumber": "NL123456789B01",
  "street": "Teststraat 1",
  "postalCode": "1234 AB",
  "city": "Utrecht",
  "website": "https://www.example.nl",
  "contact": {
    "firstName": "Jan",
    "lastName": "Jansen",
    "jobTitle": "Owner",
    "email": "jan@example.nl",
    "phone": "06 12345678"
  },
  "serviceArea": "Utrecht en omgeving",
  "employeeCount": "6-15",
  "liftCount": 4,
  "specializations": ["lakschade", "ev"],
  "accreditations": ["rdw", "bovag"],
  "hasLiabilityInsurance": true,
  "iban": "NL91 ABNA 0417 1643 00",
  "acceptedTerms": true,
  "newsletterOptIn": false
}
```

Optional: `vatNumber`, `website`, `contact.jobTitle`, `employeeCount`, `liftCount`, `specializations`, `accreditations`, `newsletterOptIn`.

| Status | Meaning |
| --- | --- |
| 201 | Registered: `{ id, status, registeredAt }` |
| 400 | Body is not valid JSON |
| 409 | KvK number already registered |
| 422 | Validation failed: `{ error, message, details: { field: message } }` |
| 500 | Unexpected error |

### Repair requests

Images go straight from the browser to Blob Storage (container `damage-images`, private) using short-lived SAS URLs.

1. `POST /api/damage-reports/upload-urls` with `{ "files": [{ "contentType": "image/jpeg" }] }` (jpeg, png, webp, heic; max 10 files) returns `{ uploads: [{ blobPath, uploadUrl, expiresAt, headers }] }`. The URL is valid for 10 minutes and write-only.
2. The browser `PUT`s each file to `uploadUrl` with the returned `headers` (`x-ms-blob-type`, `Content-Type`). Max 10 MB per image.
3. `POST /api/repair-requests` with the `blobPath`s:

```json
{
  "submissionId": "<guid, generated once per form>",
  "postalCode": "3511 AB",
  "customer": { "firstName": "Piet", "lastName": "Pietersen", "email": "piet@example.nl", "phone": "06 12345678" },
  "car": { "licensePlate": "AB-123-C", "make": "Volkswagen", "model": "Golf", "buildYear": 2018 },
  "damages": [
    {
      "description": "Deuk in het linker voorportier",
      "damageType": "carrosserie",
      "location": "left",
      "images": ["pending/<guid>.jpg"],
      "preferences": ["rental-car", "fast-repair"]
    }
  ]
}
```

Each damage becomes one damage report plus one repair request (with its own preferences). `damageType` is required (`lakschade`, `carrosserie`, `ruitschade`, `bumper`, `ev`, `overig`) and so is `postalCode`, the place of the repair; garages only see its first four digits. `submissionId` makes the call idempotent: sending the same id again (a retry after a lost response) returns the original requests with `200` instead of creating duplicates. `location` is optional (`front`, `rear`, `left`, `right`, `roof`, `windscreen`, `wheels`, `interior`, `other`), `preferences` are slugs from `CustomerRepairPreferences` (add or deactivate rows there to change the list), 1-10 images per damage, max 10 damages. Responds `201 { repairRequests: [{ id, damageReportId, status, createdAt }] }`, or `422` with `details` per field (including unknown preference slugs and images that were not uploaded).

`GET /api/repair-preferences` returns the selectable preferences as `{ preferences: [{ slug, name }] }` (active rows only, in `SortOrder`) so the UI does not hardcode them.

The customer is reused by email and the car by license plate; stored details are never overwritten from the request. Ownership is only recorded when the car has no current owner.

Storage setup in Azure: a lifecycle rule that deletes blobs with prefix `damage-images/pending/` after 1 day (abandoned uploads), CORS allowing `PUT` from the website origin, and for the Function App's managed identity the roles *Storage Blob Data Contributor* and *Storage Blob Delegator*. App setting: `IMAGE_STORAGE_ACCOUNT_NAME` (locally `IMAGE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`). The container `damage-images` must exist.

### Garage endpoints (login required)

Garages see open repair requests and judge for themselves whether to take a job.

- `GET /api/garage/repair-requests` lists the newest requests that still need a garage: `{ repairRequests: [{ id, createdAt, car: { make, model, buildYear }, description, damageType, location, postalArea, status, myOffer, imageCount, thumbnailUrl, thumbnailUrls, preferences: [{ slug, name }] }] }`. `thumbnailUrls` holds the first two photos (for the card), `thumbnailUrl` the first one.
- `GET /api/garage/repair-requests/{id}` returns one request (same fields, without the thumbnails) with `images: [{ url }]`; 404 when it does not exist or is no longer open.
- **Status.** Every request has a `status`. Stored in `RepairRequests.Status`: `open` (new; UI "Nieuw"), `accepted` (the customer accepted an offer; "Geaccepteerd"), `in_progress`, `completed`, `cancelled`. On top of that the API reports **`in_option`** ("In optie"): an `open` request that has an active offer whose deadline has not passed (`Offers.Status = 'active'` and `ExpiresAt` in the future). It is worked out on every read and never stored, so it ends by itself when the offer expires.
- **`myOffer`** is the calling garage's own running offer (`{ id, availableFrom, validityHours, expiresAt, createdAt }`), or `null`. Offers of other garages are never visible: for them a request is just `in_option`, without who, what or until when. A request that is `in_option` is reserved: other garages get a 409 when they try to make an offer.
- Image URLs are read-only SAS links valid for 15 minutes; the container stays private. They are only handed out after the caller has been checked.
- No personal data is exposed: no customer details and no license plate. Contact details are meant to be released only once a garage has taken the job (not built yet).
- 401 when not signed in, 403 when the user is not linked to a garage with status `approved`.

- `POST /api/garage/repair-requests/{id}/offers` makes an offer on an open request:

  ```json
  { "availableFrom": "2026-10-12", "validityHours": 24 }
  ```

  `availableFrom` is the first day the garage can do the repair (yyyy-mm-dd, today in Dutch time up to 365 days ahead); `validityHours` is
  12, 24 or 48. The garage and the user come from the login, never from the body. The expiry time is computed on the server from the moment
  the offer is made. There is no price yet (the price model is still open, see `SUGGESTIONS.md`).

  | Status | Meaning |
  | --- | --- |
  | 201 | Created: `{ id, repairRequestId, availableFrom, validityHours, expiresAt, status: "active", createdAt }` |
  | 400 | Body is not valid JSON |
  | 401 / 403 | Not signed in / not linked to an approved garage |
  | 404 | The request does not exist or is no longer open (the same answer for both) |
  | 409 | `already_offered`: this garage already has an active offer on this request. `in_option`: another garage has an active offer, so the request is reserved for it until its deadline. An offer that has expired never blocks anyone |
  | 422 | Validation failed: `{ error, message, details: { field: message } }` |

**Authentication.** The Function App uses App Service Authentication (Easy Auth) with Microsoft Entra External ID: set it to *Allow unauthenticated access* (the registration and submit endpoints are public) and let it validate bearer tokens. It passes the user's object id in `x-ms-client-principal-id`, which `GarageUsers.ExternalId` maps to a garage (see migration 003; link users with an INSERT for now). Setup in short:

1. Create an External ID tenant, a user flow and two app registrations: one for the API (expose a scope such as `access_as_user`) and one single-page app for the dashboard (redirect URIs of the garage site, permission to the API scope).
2. Function App → *Authentication* → add the Microsoft provider for the API registration, "Allow unauthenticated access".
3. Fill in `auth-config.js` in herstel-garage-web (client id, authority, API scope).
4. Allow the garage site's origin in the Function App's CORS settings.

Locally set `ALLOW_DEV_AUTH=true` (already in local.settings) and send `x-dev-user-id: <ExternalId of a GarageUsers row>`; the dashboard asks for it on localhost. This is refused whenever `WEBSITE_SITE_NAME` is set, so it cannot be active in Azure.

## Local development

Requires Node 20+, Docker, [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) (the Functions host itself needs a storage account).

```sh
npm install
docker compose up -d --wait        # local SQL Server on localhost:1433
npm run migrate:local              # creates database "herstel" and applies db/migrations
npx azurite --silent --skipApiVersionCheck --location .azurite &   # flag needed: the Storage SDK may be newer than Azurite
func start                         # http://localhost:7071
npm test
```

Copy `local.settings.example.json` to `local.settings.json` if it is missing.

## Database

Schema lives in `db/migrations/*.sql` (batches separated by `GO`); `npm run migrate` applies new files in order (`migrate:local` also creates the database; use it only against the local container) and records them in `dbo.SchemaMigrations`.
Configuration: `SQL_CONNECTION_STRING` (local.settings.json locally, app setting in Azure).
Azure with managed identity (no password): `Server=<name>.database.windows.net;Database=sqldb-herstel-prod;Authentication=Active Directory Default;Encrypt=true`
