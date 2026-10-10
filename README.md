# herstel-garage-api

Azure Functions (Node.js, v4 programming model) backend for SnelHerstel.nl partner garages.
Registrations are stored in Azure SQL Database (SQL Server in Docker locally).

## Endpoints

### `POST /api/garages/register`

Registers a garage (status `pending`, awaiting verification). The KvK number is the unique key.

**Through an invitation.** A garage we reached out to (a prospect, see below) signs up through the button on its share link. The sign-up
form then sends the link's token as `invitationToken`. That garage is **approved straight away** (status `approved`), and its prospect
is linked to it (`GarageProspects.GarageId`, status `registered`). A registration without a token whose KvK number matches a prospect is
linked to that prospect too, but stays `pending`. A revoked link does not count as an invitation; an expired one still does. The
response has `invited: true` for a registration through an invitation. The garage's login still has to be linked by hand (see TODO.md).

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

`specializations` and `accreditations` are slugs of active rows in the `Specializations` / `Accreditations` tables; an unknown slug gives a 422.
`GET /api/specializations` and `GET /api/accreditations` return the selectable options as `{ specializations: [{ slug, name }] }` and
`{ accreditations: [{ slug, name }] }` (active rows only, in `SortOrder`); the sign-up form builds its checkboxes from them.

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

- `GET /api/garage/repair-requests` lists the newest requests that still need a garage: `{ repairRequests: [{ id, createdAt, car: { make, model, buildYear }, description, damageType, location, postalArea, distanceKm, status, myOffer, viewCount, imageCount, thumbnailUrl, preferences: [{ slug, name }] }] }`. `thumbnailUrl` is the first photo (for the card), `imageCount` the total number of photos.
- **Distance.** `distanceKm` is the distance from the garage's postal code to the request's, as the crow flies, in whole kilometres (`null` when either is unknown). Both postal codes are looked up once, when the garage registers or the request is submitted, in the PDOK Locatieserver (free, no key; `src/lib/geocoder.js`), and stored as `Latitude`/`Longitude` (migration 011). A failed lookup never fails the registration or the request: the row is stored without coordinates. Only the rounded number leaves the API, never the coordinates. Rows without coordinates (from before migration 011, or after a failed lookup) are filled in by `node scripts/geocode-backfill.js` (it needs `SQL_CONNECTION_STRING`; safe to run again).
- `GET /api/garage/repair-requests/{id}` returns one request (same fields, without the thumbnails) with `images: [{ url }]`; 404 when it does not exist or is no longer open.
- **Views.** Opening a request (`GET /api/garage/repair-requests/{id}`) records a view in `RepairRequestViews` (migration 009): which garage user, which request, when. The same user opening the same request again within 30 minutes (`VIEW_GAP_MINUTES` in `src/lib/repairRequestViewRepository.js`) is the same visit and is not counted again; after that it counts as a new view. `viewCount` is the number of views by all garages together; garages never see who viewed. Only open requests are counted, and a failure to record a view never stops the request from being shown.
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

### Sharing a repair request with garages (links)

The platform team makes a link to one repair request for one garage, and shares it (for example in WhatsApp). The link opens a public
page, without login, with a few details and the photos, and a button. Table: `RepairRequestShareLinks` (migrations 007 and 010). One link
per request and recipient: making it again returns the running one. Default lifetime 7 days. Tokens are stored as they are, so a link can be
copied again later; a token only gives a limited view of one request.

**Garages and prospects.** A link goes to a garage in the network (`Garages`, status `approved`) or to a **prospect**: a garage that
meets our criteria but has not signed up (`GarageProspects`, migration 010). Prospects are kept out of `Garages` on purpose: they lack the
sign-up data, and nothing that means "garages in our network" can pick them up by accident. A prospect goes `new` → `contacted` (its first
link) → `registered` (it signed up; `GarageId` points to its garage). On the page, a garage's button leads to the request in the dashboard;
a prospect's button leads to the sign-up form (`aanmelden-garage.html#uitnodiging=<token>` on the website), and signing up there approves
the garage straight away.

**Administrator endpoints** (login required, and the login must be on the `ADMIN_USER_IDS` list; see settings below). They live under
`/api/backoffice/...` and not under `/api/admin/...`: in production every `/api/admin/...` request was answered with an empty 404 before it reached
the function, because Azure keeps that name for its own management endpoints. Do not use `admin` as a route name (a test guards this).

| Endpoint | What it does |
| --- | --- |
| `GET /api/backoffice/me` | `{ isAdmin }` for any signed-in user (the dashboard uses it to show the menu item) |
| `GET /api/backoffice/repair-requests` | The open requests a link can be made for (same shape as the garage list) |
| `GET /api/backoffice/garages` | The approved garages a link can be made for: `{ garages: [{ id, companyName, city }] }` |
| `GET /api/backoffice/prospects` | All prospects: `{ prospects: [{ id, companyName, city, street, postalCode, phone, email, website, kvkNumber, notes, status, garageId, createdAt, linkCount }] }` |
| `POST /api/backoffice/prospects` | Adds a prospect: `{ companyName, city, street?, postalCode?, phone?, email?, website?, kvkNumber?, notes? }`. Only the name and the place are required. 201 with the prospect; 422 for invalid input; 409 when another prospect has the same KvK number |
| `POST /api/backoffice/share-links` | `{ repairRequestId, garageIds?: [...], prospectIds?: [...], expiresInDays? }` (1 to 90, default 7). Makes one link per garage and per prospect (together at least 1 and at most 50). A recipient that already has a running link for this request gets that one back (`existing: true`); a prospect that gets its first link becomes `contacted`. 201 `{ links: [{ id, url, repairRequestId, recipient: { type: 'garage' \| 'prospect', id, companyName, city }, createdAt, expiresAt, existing }] }`; 404 when the request is gone or no longer open; 422 for invalid input, a garage that does not exist or is not approved, or a prospect that does not exist or signed up already |
| `GET /api/backoffice/share-links` | `{ stats, links }`: the newest 500 links, each with its `recipient`, `status` (`active`, `expired`, `revoked`), `firstOpenedAt`, `lastOpenedAt`, `openCount`, `firstPreviewAt`, `previewCount`, `firstClickedAt`, `clickCount`; and `stats`: `totalLinks`, `openedLinks`, `openRate` (0 to 1, null without links) and `averageSecondsToOpen` (null when none was opened) |
| `GET /api/backoffice/onboarding` | The onboarding funnel: `{ invites: [{ id, garageId, garageName, city, repairRequestTitle, events: { linkShared, linkOpened, viewRequestClicked, registered, requestViewed, offerCreated } }] }`, one per link to a prospect or to a garage that came from one (links to garages that joined on their own are left out). `garageId` is the prospect's id, also on its later invites as a garage, so they group together. Each event is the first time that step happened (null when not yet): link made, opened by a person, button clicked, the garage signed up, the request viewed by a user of the garage, an offer by the garage. The dashboard works out the rest |
| `DELETE /api/backoffice/share-links/{id}` | Revokes a link: it stops working at once. 204, or 404 |

**Public endpoints** (no login):

| Endpoint | What it does |
| --- | --- |
| `GET /api/s/{token}` | The page. Server-rendered HTML with Open Graph tags (title, short description, first photo), because chat apps build the link preview from those tags and do not run JavaScript. Shows the car, kind of damage, location, postal area, photos and a button to the dashboard. It does **not** show the customer's own description, a license plate, contact details, or anything about offers |
| `GET /api/s/{token}/open` | The button on the page. Counts the click (`firstClickedAt`, `clickCount`; the same rules as an open: people only, not `HEAD` and not `?nc=1`) and answers 302: a garage to the request in the dashboard, a prospect to the sign-up form with the link as its invitation. A link that does not work gives the same 404 page as the link itself |
| `GET /api/s/{token}/photo/{n}` | Photo number n (1-based), served through the API, so the preview's photo address keeps working for as long as the link does (a storage link would expire after 15 minutes). HEIC photos are left out: browsers and chat apps cannot show them |

An unknown, expired or revoked link, and a request that is no longer open, all give the same plain 404 page, so nothing can be learned from the answer. The page is not indexed (`noindex`), not cached, and passes no Referer.

**What counts as "opened".** A person opening the page counts as an open (first time, last time, how often). Chat apps and other link previewers fetch the page too, to build the preview; those are recognised by their User-Agent (`src/lib/shareToken.js`, `isPreviewBot`) and counted separately as a *preview* (`previewCount`), never as an open, so sharing the link does not inflate the open rate. A preview shows that the link was pasted into a chat. `HEAD` requests and `?nc=1` (added by the "Openen" button on the admin page, so testing a link does not count) are not counted at all. This is best effort: a program that pretends to be a browser counts as a person.

**Settings** (Function App settings; locally in `local.settings.json`):

| Setting | Meaning |
| --- | --- |
| `ADMIN_USER_IDS` | Comma-separated Entra object ids of the platform administrators. **Empty means nobody is an administrator**, so set it before using the admin page. Use the same object id as in `GarageUsers.ExternalId` |
| `SHARE_BASE_URL` | Optional. The address in front of `/s/<token>` in the links, for a short or custom domain. Default: the Function App's own address (`https://<app>.azurewebsites.net/api`) |
| `DASHBOARD_URL` | Optional. Where the page's button leads a garage in the network. Default `https://garage.snelhersteld.nl` |
| `CUSTOMER_SITE_URL` | Optional, also used for the customer page. The website whose sign-up form the button leads a prospect to. Default `https://snelhersteld.nl` |

### The customer's page: view and answer an offer

Every repair request has a customer token (migration 008), made when it is submitted. The submit response gives the customer's link,
`customerUrl` = `https://snelhersteld.nl/mijn-aanvraag.html#<token>` (herstel-web). The token sits after the `#`, so it is never sent to the
website's server. There is no login: the link is the key. It only lets the holder see that one request and accept or decline an offer on it.

| Endpoint | What it does |
| --- | --- |
| `GET /api/customer/repair-requests/{token}` | `{ request, offers, nextSteps }`. `request.stage` is `waiting_for_offer`, `offer_received`, `accepted`, `in_progress`, `completed` or `cancelled`. `offers` holds only the running offer and the accepted one; the garage's phone and email are only included once its offer is accepted. `nextSteps` is the explanation for the customer (`src/lib/customerNextSteps.js`): title, summary, warnings and steps, each step marked with who acts (`you`, `garage`, `us`) |
| `POST /api/customer/repair-requests/{token}/offers/{offerId}/accept` | Accepts a running offer: offer `accepted`, request `accepted`. 200 with the new view; 409 `request_closed`, `offer_expired` or `offer_closed`; 404 `not_found`. Accepting twice is fine |
| `POST /api/customer/repair-requests/{token}/offers/{offerId}/decline` | Declines a running offer: offer `declined`, the request stays open so other garages can make an offer again. Same answers |
| `POST /api/backoffice/repair-requests/{id}/customer-link` | Administrators: `{ customerUrl }` for a request, to send to the customer by hand. Requests from before migration 008 get a token now |

What the customer is told depends on the stage and on what they said in the form: whether the car can still drive (`carDrivable`:
`yes`, `no`, `unknown`), where it is (`carLocation`: `home`, `towing`, `other`), and the preferences pickup, rental car and insurance.
Both fields are optional in `POST /api/repair-requests`, so older forms keep working.

| Setting | Meaning |
| --- | --- |
| `CUSTOMER_SITE_URL` | Optional. The website in front of `/mijn-aanvraag.html#<token>`. Default `https://snelhersteld.nl` |

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
