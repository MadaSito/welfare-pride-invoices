UPDATE `recurring_invoice_schedules` SET `invoicePrefix` = CONCAT('REC', `id`) WHERE `invoicePrefix` = 'REC';--> statement-breakpoint
ALTER TABLE `recurring_invoice_schedules` ADD CONSTRAINT `recurring_invoice_schedules_company_prefix_uq` UNIQUE(`companyId`,`invoicePrefix`);
