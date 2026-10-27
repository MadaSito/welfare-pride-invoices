ALTER TABLE `invoices` MODIFY COLUMN `status` enum('draft','finalized','sending','sent','paid','void') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `eventKey` varchar(240) DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `webhook_events` SET `eventKey` = CONCAT('legacy-', `id`) WHERE `eventKey` = '';--> statement-breakpoint
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_provider_event_key_uq` UNIQUE(`provider`,`eventKey`);
