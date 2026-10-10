-- Which garage user looked at which repair request, and when. One row is one view.
--
-- A view is recorded when a garage user opens a request's detail page (GET /api/garage/repair-requests/{id}). Opening it again within
-- the gap (VIEW_GAP_MINUTES in src/lib/repairRequestViewRepository.js) is the same visit and adds nothing, so refreshing the page does not
-- inflate the count; after the gap it counts as a new view. The garage follows from the user (GarageUsers.GarageId).
CREATE TABLE dbo.RepairRequestViews (
    Id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RepairRequestViews_Id DEFAULT NEWSEQUENTIALID(),
    RepairRequestId UNIQUEIDENTIFIER NOT NULL,
    GarageUserId    UNIQUEIDENTIFIER NOT NULL,
    ViewedAt        DATETIME2(0)     NOT NULL CONSTRAINT DF_RepairRequestViews_ViewedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RepairRequestViews PRIMARY KEY (Id),
    CONSTRAINT FK_RepairRequestViews_RepairRequests FOREIGN KEY (RepairRequestId) REFERENCES dbo.RepairRequests (Id),
    CONSTRAINT FK_RepairRequestViews_GarageUsers FOREIGN KEY (GarageUserId) REFERENCES dbo.GarageUsers (Id)
);
GO

-- The view count per request (shown on every card in the overview).
CREATE INDEX IX_RepairRequestViews_RepairRequestId ON dbo.RepairRequestViews (RepairRequestId);
GO

-- "Did this user view this request within the gap?", asked before every new view. Also what the lock on that check uses, so two
-- requests arriving at the same moment cannot both record a view.
CREATE INDEX IX_RepairRequestViews_UserRequest ON dbo.RepairRequestViews (GarageUserId, RepairRequestId, ViewedAt);
GO
