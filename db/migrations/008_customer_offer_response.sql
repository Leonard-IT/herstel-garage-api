-- The customer's side of an offer: a private link to their request, the answers that decide what happens after they accept (can the
-- car still drive, where is it), and when they answered an offer.
-- Each ALTER is its own batch (GO): SQL Server compiles a batch before running it, so a column added in the same batch cannot be
-- referenced yet.

-- 1. CustomerToken: the secret in the customer's link to their own request (mijn-aanvraag.html#<token>). 32 random bytes as base64url
--    (43 characters), made by the API when the request is submitted. Stored as is, like the share link tokens, so that the team can
--    send the link again during the pilot (there is no email yet). Requests from before this migration get one when the team asks the
--    backoffice for their link. Whoever has the link can see the request and accept or decline an offer on it, nothing more.
ALTER TABLE dbo.RepairRequests ADD CustomerToken CHAR(43) NULL;
GO

CREATE UNIQUE INDEX UX_RepairRequests_CustomerToken ON dbo.RepairRequests (CustomerToken) WHERE CustomerToken IS NOT NULL;
GO

-- 2. What the customer told us about the car: whether it can still be driven safely, and where it is now. Both decide the next steps
--    after accepting an offer (drive it there, or the garage arranges transport; a towing yard charges per day). NULL: not asked
--    (older requests) or not answered.
ALTER TABLE dbo.RepairRequests ADD
    CarDrivable VARCHAR(10) NULL CONSTRAINT CK_RepairRequests_CarDrivable CHECK (CarDrivable IN ('yes', 'no', 'unknown')),
    CarLocation VARCHAR(20) NULL CONSTRAINT CK_RepairRequests_CarLocation CHECK (CarLocation IN ('home', 'towing', 'other'));
GO

-- 3. When the customer accepted or declined an offer. Status says which; this says when (time to answer is a pilot metric).
ALTER TABLE dbo.Offers ADD RespondedAt DATETIME2(0) NULL;
GO
