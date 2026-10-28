ALTER TABLE `email_logs` MODIFY COLUMN `status` enum('queued','sent','failed','uncertain') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `recurring_invoice_runs` MODIFY COLUMN `status` enum('running','created','sent','failed','uncertain') NOT NULL DEFAULT 'running';--> statement-breakpoint
ALTER TABLE `email_logs` ADD `attemptKey` varchar(96);--> statement-breakpoint
ALTER TABLE `recurring_invoice_runs` ADD `leaseExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `email_logs` ADD CONSTRAINT `email_logs_attempt_key_uq` UNIQUE(`attemptKey`);