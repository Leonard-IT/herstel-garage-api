-- Adds 'accepted' (the customer accepted an offer; the job is assigned to that garage) to the stored statuses of a repair request.
--
-- "in option" is deliberately NOT a stored status. A request is in option while it is 'open' and has an active offer that has not passed
-- its deadline (Offers.Status = 'active' AND Offers.ExpiresAt > now). The API works that out on every read, so it can never be out of
-- date when an offer lapses, and nothing has to be swept or reset.
ALTER TABLE dbo.RepairRequests DROP CONSTRAINT CK_RepairRequests_Status;
GO

ALTER TABLE dbo.RepairRequests ADD CONSTRAINT CK_RepairRequests_Status
    CHECK (Status IN ('open', 'accepted', 'in_progress', 'completed', 'cancelled'));
GO
