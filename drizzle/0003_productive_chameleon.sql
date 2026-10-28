CREATE TABLE `recurring_invoice_line_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleId` int NOT NULL,
	`position` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unitPriceCents` int NOT NULL DEFAULT 0,
	`taxable` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recurring_invoice_line_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recurring_invoice_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleId` int NOT NULL,
	`occurrenceKey` varchar(48) NOT NULL,
	`status` enum('running','created','sent','failed') NOT NULL DEFAULT 'running',
	`invoiceId` int,
	`note` varchar(500),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `recurring_invoice_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `recurring_invoice_runs_schedule_occurrence_uq` UNIQUE(`scheduleId`,`occurrenceKey`)
);
--> statement-breakpoint
CREATE TABLE `recurring_invoice_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`contactId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`cadence` enum('weekly','monthly') NOT NULL,
	`dayOfWeek` int,
	`dayOfMonth` int,
	`hourUtc` int NOT NULL DEFAULT 9,
	`minuteUtc` int NOT NULL DEFAULT 0,
	`dueDays` int NOT NULL DEFAULT 30,
	`autoSend` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`heartbeatTaskUid` varchar(160) NOT NULL,
	`nextRunAt` timestamp,
	`lastRunAt` timestamp,
	`lastInvoiceId` int,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`taxRateBps` int NOT NULL DEFAULT 0,
	`discountRateBps` int NOT NULL DEFAULT 0,
	`notes` text,
	`terms` text,
	`paymentInstructions` text,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recurring_invoice_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `recurring_invoice_schedules_task_uq` UNIQUE(`heartbeatTaskUid`)
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `recurringScheduleId` int;--> statement-breakpoint
ALTER TABLE `invoices` ADD `recurringOccurrenceKey` varchar(48);--> statement-breakpoint
UPDATE `invoices` SET `invoiceNumber` = CONCAT('DRAFT-LEGACY-', `id`) WHERE `status` IN ('draft', 'finalized') AND `invoiceNumber` NOT LIKE 'DRAFT-%';--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_recurring_occurrence_uq` UNIQUE(`recurringScheduleId`,`recurringOccurrenceKey`);--> statement-breakpoint
ALTER TABLE `recurring_invoice_line_items` ADD CONSTRAINT `recurring_line_items_schedule_fk` FOREIGN KEY (`scheduleId`) REFERENCES `recurring_invoice_schedules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_invoice_runs` ADD CONSTRAINT `recurring_runs_schedule_fk` FOREIGN KEY (`scheduleId`) REFERENCES `recurring_invoice_schedules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_invoice_runs` ADD CONSTRAINT `recurring_runs_invoice_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_invoice_schedules` ADD CONSTRAINT `recurring_schedules_company_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_invoice_schedules` ADD CONSTRAINT `recurring_schedules_contact_fk` FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_invoice_schedules` ADD CONSTRAINT `recurring_schedules_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `recurring_invoice_items_schedule_idx` ON `recurring_invoice_line_items` (`scheduleId`);--> statement-breakpoint
CREATE INDEX `recurring_invoice_runs_schedule_started_idx` ON `recurring_invoice_runs` (`scheduleId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `recurring_invoice_schedules_company_active_idx` ON `recurring_invoice_schedules` (`companyId`,`isActive`);--> statement-breakpoint
CREATE INDEX `recurring_invoice_schedules_contact_idx` ON `recurring_invoice_schedules` (`contactId`);--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_recurring_schedule_fk` FOREIGN KEY (`recurringScheduleId`) REFERENCES `recurring_invoice_schedules`(`id`) ON DELETE set null ON UPDATE no action;
