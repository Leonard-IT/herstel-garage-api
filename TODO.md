# TODO

Open work on this API and the garage dashboard (`herstel-garage-web`).

## Linking a login to a garage (multiple users per garage)

**Today:** a login (Entra External ID user) is linked to a garage by hand, with an INSERT into `dbo.GarageUsers`
(see migration 003). Nothing connects the registration form (`Garages`, status `pending`) to the person who signs up in Entra.

**Decision:** yes, allow several users per garage. The schema already allows it: `GarageUsers.GarageId` is not unique,
`GarageUsers.ExternalId` (the Entra object id) is. A person belongs to one garage.

**Proposed flow: invitation by email**

1. **Garage approved** (admin action, see "Admin dashboard"). The system creates an invitation for the registration's
   contact email with role `owner` and sends an email with a link such as `/accept-invite.html?token=...`.
2. **Invited person opens the link**, signs in or signs up through the `garage-signin` user flow.
3. **The page calls `POST /api/garage/invitations/accept`** with the token (bearer token of the new login). In one transaction the API:
   - looks up the invitation by token hash and rejects it when it is unknown, expired, already used or revoked;
   - checks that the caller's verified email equals the invited email (needs the `email` claim in the token);
   - inserts the `GarageUsers` row (`GarageId`, `ExternalId` = caller's `oid`, `Role`) and marks the invitation accepted.
4. **Owners invite colleagues** from the dashboard (Instellingen): `POST /api/garage/invitations { email, role }`.
   Same acceptance flow as above, with role `member`.
5. **Owners manage users**: `GET /api/garage/users`, `DELETE /api/garage/users/{id}`. Rules: a garage always keeps at least one
   owner; removal takes effect immediately, because access is checked against the database on every request.

**Data model (new migration)**

- `GarageUsers.Role` (`owner` | `member`), default `member`.
- `GarageInvitations`: `Id`, `GarageId`, `Email`, `Role`, `TokenHash` (store a hash, never the token), `ExpiresAt` (7 days),
  `AcceptedAt`, `AcceptedByUserId`, `RevokedAt`, `CreatedBy`, `CreatedAt`.

**Open questions**

- Which service sends the email (for example Azure Communication Services Email)?
- Can one person work for several garages (for example a bookkeeper)? Today no (`ExternalId` is unique).
- Optional later: auto-link on approval by matching the verified sign-up email to the registration's contact email, without
  an invite. Only worth it once the invite flow exists.
- Until this is built: insert `GarageUsers` rows manually when a garage is approved.

## Matching garages to requests

To do, so garages can be matched and judge distance:

- `Garages.ServiceArea` is free text and cannot be queried. Replace it with structured coverage (a geocoded point plus a radius,
  or a `GarageServicePostalAreas` table) and geocode garage and request locations.
- Use damage type and distance to decide which garages see a request, and for the auction duration per damage type (PROJECT.md).
- Show distance to the garage in the dashboard instead of only the postal area.

## Data model follow-ups (from the database review)

- **Car data from RDW.** Car make, model and year are whatever the first submitter typed, and are never corrected. Look the plate up in
  the RDW open data and store make, model, build year and fuel type from there; keep user input as fallback.
- **GDPR.** No way to delete or anonymize a customer: `Customers` is referenced by foreign keys without cascade, and photos are personal
  data. Add `DeletedAt` and an anonymize routine, plus a retention period for cancelled or unassigned requests (including the blobs).
- **Status history.** `RepairRequests.Status` has no "in optie" stored (it is worked out from the offers, see the README). PROJECT.md
  also needs the exclusivity window (who and until when) and the price-clock start. Add a `RepairRequestEvents` table (who, what, when)
  as audit trail.
- **Taxatie.** Home for the independent appraisal: amount, expert, date.
- **Photo angle.** Optional `Label` on `DamageReportImages` (front, rear, close-up...).
- **Lookup tables.** `GarageSpecializations.Code`, `GarageAccreditations.Code`, `DamageLocation`, `DamageType` and `RepairRequests.Status`
  are only validated in code or by CHECK. Make them lookup tables like `CustomerRepairPreferences`.
- **Garage contact person vs `GarageUsers`.** `Garages` stores contact name and email, which duplicates `GarageUsers` once invitations exist.
  Treat the registration contact as the first owner.
- **Approval trail.** `Garages` has `Status` but not who approved or rejected, when, or why (`ApprovedAt`, `ApprovedBy`, rejection reason).
- **`UpdatedAt`** on tables whose rows change (`Garages`, `RepairRequests`, `Customers`).
- **Minor.** `BlobPath` and `ContentType` could be `VARCHAR`; decide whether the IBAN needs column encryption; add an issuer column to
  `GarageUsers` if logins can come from two tenants.

## Taking a job

The dashboard has the offer screens (herstel-garage-web, `src/features/offers`: pick a start date, choose how long the offer is valid,
review everything, confirm) and send the offer to `POST /api/garage/repair-requests/{id}/offers`. While an offer runs, the request is
"in option" (status `in_option`, worked out from the offers; see the README). Ideas for the content of an offer are in `SUGGESTIONS.md`.

- [ ] **Decide the price model first**: price clock from PROJECT.md (the garage accepts the current price) or the garage enters a price.
      See `SUGGESTIONS.md`; it decides the screens and the table.
- [ ] Apply migrations 005 and 006 and try the flow once against a real database (the SQL has only been reviewed, not run).
- [ ] Decide whether other garages may make an offer while a request is in option. Today they get 409 `in_option`, as PROJECT.md
      describes (exclusivity window). To allow parallel offers, remove the check in `src/lib/offerRepository.js` and adjust the label.
- [x] Decide who may accept an offer and what happens then: the customer, on their own page (`mijn-aanvraag.html` in herstel-web, see
      the README). Accepting sets the offer and the request to `accepted`; declining sets the offer to `declined` and the request stays open.
- [ ] Count in-option requests separately in the dashboard (the "Openstaande aanvragen" badge now includes them) and let a garage see
      the end of its own option on the card ("nog 5 uur").
- [ ] List a garage's offers (`GET /api/garage/offers`), and withdraw an offer (`status = withdrawn`) with the rules from `SUGGESTIONS.md`.
- [ ] Sweep or ignore expired offers: today an offer is only marked `expired` when the same garage makes a new one. Anything that reads
      offers must also check `ExpiresAt`.
- [ ] Rules still open: what happens to the request and the other offers when an offer is accepted (status, who can accept).
      Already enforced: only open requests, one active offer per garage and request, expiry time set on the server.
- [ ] Extra offer fields from `SUGGESTIONS.md` (duration, pickup and delivery, rental car, warranty, parts type, note, insurance handling),
      once the price model is decided.
- [ ] Release the customer's contact details to the garage once its offer is accepted. Until then garages only see the damage, photos and
      preferences (no personal data, no license plate).
- [ ] Serve the data the overview cards currently fake with example values: view count, insured amount, status and mileage
      (`exampleCardData.ts` in the dashboard).

## Customer page (view and accept an offer)

- [ ] Apply migration 008 (the pipeline does that on the next push to main) and try the whole flow once against the real database:
      submit, make an offer in the dashboard, open the customer link, accept. The SQL has been reviewed, not run.
- [ ] Get the link to the customer. The form shows it once, after submitting. Until there is email, send it by hand: the team can get it
      with `POST /api/backoffice/repair-requests/{id}/customer-link`. A button for that in the backoffice is still to do.
- [ ] Email to the customer: "request received" (with the link), "you have an offer", "your offer expires in 2 hours".
- [ ] Tell the garage that its offer was accepted, and show it the customer's name and phone number. Today an accepted request
      disappears from the garage's list (the garage endpoints only read open requests), so the garage only knows if we tell it.
- [ ] Let the garage set `in_progress` and `completed` (the customer page already explains both stages).
- [ ] A contact address for customers on the page (the texts say "neem contact met ons op", but the site has no address yet).
- [ ] Show a price on the offer, once the price model is decided.
- [ ] Ask more in the form when it pays off: insurance type (WA / allrisk / self), whether there is a damage form with another party.

## Dashboard follow-ups

- [ ] The sidebar menu wraps onto three lines on a phone; make it a compact, scrollable menu.
- [ ] Show the garage's own name (and not only the user's) in the topbar or sidebar. The API has to return the garage with the user.
- [ ] Enforce the Content-Security-Policy: it runs as `Content-Security-Policy-Report-Only` in `staticwebapp.config.json`. Check the
      browser console on production for violations, then rename the header.
- [ ] The Actieve reparaties, Historie, Facturatie and Instellingen pages still show mock data.

## Share a public link to a repair request

Built (migration 007; see the README). Tested with stubs and in a browser against a mock API; **the SQL has not been run against a
database yet**. The administrator page "Links delen" lives in the garage dashboard and is to be moved to the admin site.

Before it works in production:

- [ ] Apply migration 007 (the pipeline does that on the next push to main).
- [ ] Set `ADMIN_USER_IDS` on the Function App to the object id(s) of the people who may use the page. Empty means nobody.
- [ ] Try it for real: make a link, paste it into WhatsApp and check the preview (title, description, photo), open it on a phone and
      check that the page shows as opened. This cannot be tested without WhatsApp itself.
- [ ] The Function App must answer the public page quickly, or WhatsApp skips the preview: a cold start on a consumption plan can take
      several seconds. Consider an always-ready instance, or open the link once before sending. WhatsApp also remembers a failed preview
      for a while; make a new link when a test failed.
- [ ] Preview photos: WhatsApp shows the image reliably when it is small (roughly under 300 KB). Photos are resized in the browser to
      1600 px wide, which is often larger. A dedicated preview image (1200×630, made on the server) would be more reliable; see SUGGESTIONS.md.
- [ ] Optional: a short, own domain for the links (`SHARE_BASE_URL`), instead of the long azurewebsites.net address.
- [ ] Rate limiting on the public endpoints (tokens are 256-bit random, so guessing is not realistic, but crawlers and abuse are).

Later: see the "Links delen" section of `SUGGESTIONS.md`.

## Login setup and verification

- Create the Entra External ID tenant, the `garage-signin` user flow and the two app registrations; fill in `auth-config.js`.
- Enable authentication on the Function App ("Allow unauthenticated access") and verify that Easy Auth accepts bearer tokens from the
  external tenant. If not, validate the JWT inside the Function instead.
- Apply migrations 003 and 004 to the remote database (002 is already applied). The pipeline runs them on the next push to main.

## Admin dashboard

Build it as a separate site, with admins signing in through the company (workforce) tenant, not the external tenant.
Decide between a separate admin API (own Function App and Easy Auth) and one API validating tokens from both issuers in code.
The garage approval step that creates the first invitation lives here.
