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

## Customer location on repair requests

The plan was to show the customer's area to garages, but we don't collect it. Without it, garages can't judge distance, which
matters when deciding whether to take a job. Add an optional postal code to the request form and to `RepairRequests`, and show
the area (not the full postal code) to garages. Needs a new migration, since 002 is already applied remotely. Next small follow-up.

## Taking a job

Making an offer and releasing the customer's contact details to the garage are not built. Garages currently only see
the damage, photos and preferences (no personal data, no license plate).

## Mock fields removed from the dashboard

Removed from the Openstaande aanvragen mockup, because we don't collect them: taxatie, insurer, kilometerstand and fee rows,
and the offer form ("Stel je aanbod samen"). The page now only shows what actually exists. Bring these back, backed by real
data, when the offer flow is built (see "Taking a job").

## Login setup and verification

- Create the Entra External ID tenant, the `garage-signin` user flow and the two app registrations; fill in `auth-config.js`.
- Enable authentication on the Function App ("Allow unauthenticated access") and verify that Easy Auth accepts bearer tokens from the
  external tenant. If not, validate the JWT inside the Function instead.
- Apply migrations 002 (already applied) and 003 to the remote database.

## Admin dashboard

Build it as a separate site, with admins signing in through the company (workforce) tenant, not the external tenant.
Decide between a separate admin API (own Function App and Easy Auth) and one API validating tokens from both issuers in code.
The garage approval step that creates the first invitation lives here.
