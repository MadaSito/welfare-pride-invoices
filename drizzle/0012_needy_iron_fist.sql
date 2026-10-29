ALTER TABLE `recurring_invoice_schedules` RENAME COLUMN `heartbeatTaskUid` TO `schedulerKey`;--> statement-breakpoint
ALTER TABLE `recurring_invoice_schedules` DROP INDEX `recurring_invoice_schedules_task_uq`;--> statement-breakpoint
ALTER TABLE `recurring_invoice_schedules` ADD CONSTRAINT `recurring_invoice_schedules_task_uq` UNIQUE(`schedulerKey`);