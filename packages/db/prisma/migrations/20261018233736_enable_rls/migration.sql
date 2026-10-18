-- Row Level Security (01-architecture-technique.md §3) : "ceinture et bretelles"
-- en complément du filtrage applicatif de packages/db/src/tenant.ts.
--
-- Le rôle "atelieros" (POSTGRES_USER du conteneur Docker) est superutilisateur
-- et bypasse donc RLS nativement : il reste réservé à adminDb (infrastructure,
-- migrations, seed, scripts d'administration, tests d'isolation A/B).
--
-- Un second rôle, non superutilisateur et sans BYPASSRLS, est créé ici pour les
-- requêtes applicatives passant par db.forTenant(ctx) : FORCE ROW LEVEL SECURITY
-- s'applique donc réellement à ce rôle, qui ne peut voir/modifier que les lignes
-- de l'organisation définie par `SET app.organization_id` (set_config) dans la
-- transaction en cours.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'atelieros_app') THEN
    CREATE ROLE atelieros_app LOGIN PASSWORD 'atelieros_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO atelieros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atelieros_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atelieros_app;

ALTER DEFAULT PRIVILEGES FOR ROLE atelieros IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atelieros_app;
ALTER DEFAULT PRIVILEGES FOR ROLE atelieros IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO atelieros_app;

-- Une policy par table métier porteuse de organizationId (générée depuis le DMMF
-- du schema.prisma pour rester exhaustive et synchronisée avec le modèle).

ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Site" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Site"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Bay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Bay" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Bay"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Customer"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CustomerContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerContact"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Vehicle"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "MileageReading" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MileageReading" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MileageReading"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "VehicleEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VehicleEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VehicleEvent"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Appointment"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "RepairOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RepairOrder"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "RepairOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairOrderLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RepairOrderLine"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Inspection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Inspection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Inspection"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "InspectionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InspectionItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InspectionItem"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "InspectionTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InspectionTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InspectionTemplate"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "LaborOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LaborOperation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LaborOperation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeEntry"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Attendance"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Quote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Quote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Quote"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "QuoteLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuoteLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "QuoteLine"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "StockLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLevel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockLevel"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockMovement"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseOrder"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseOrderLine"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceLine"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentAllocation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PaymentLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentLink"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CashSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CashSession"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Expense"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CollectionCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CollectionCase"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PaymentPromise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPromise" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentPromise"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CollectionNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CollectionNote"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ReminderRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReminderRule"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Reminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reminder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Reminder"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ReminderSuppression" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderSuppression" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReminderSuppression"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "MessageTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MessageTemplate"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Conversation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Message"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "MessageStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageStatusEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MessageStatusEvent"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ChannelConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChannelConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChannelConfig"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "OptOut" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OptOut" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OptOut"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PaymentProviderConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentProviderConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentProviderConfig"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "FneConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FneConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FneConfig"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "DataSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataSource"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportJob"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ImportRowError" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportRowError" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportRowError"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ExternalRef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalRef" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExternalRef"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApiKey"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookEndpoint"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "InsuranceCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InsuranceCompany" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InsuranceCompany"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "InsuranceClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InsuranceClaim" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InsuranceClaim"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Attachment"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "DocumentSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentSequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentSequence"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "DomainEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DomainEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DomainEvent"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AiInteraction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiInteraction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiInteraction"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Holiday"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PortalToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PortalToken"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
