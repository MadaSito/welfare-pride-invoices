CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int,
	`actorUserId` int,
	`eventType` varchar(120) NOT NULL,
	`resourceType` varchar(80),
	`resourceId` varchar(96),
	`outcome` enum('success','failure') NOT NULL,
	`correlationId` varchar(96) NOT NULL,
	`ipHash` varchar(96),
	`metadataJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`name` varchar(160) NOT NULL,
	`legalName` varchar(220),
	`email` varchar(320),
	`phone` varchar(64),
	`website` varchar(320),
	`addressLine1` varchar(220),
	`addressLine2` varchar(220),
	`city` varchar(120),
	`region` varchar(120),
	`postalCode` varchar(32),
	`country` varchar(2),
	`primaryColor` varchar(7) NOT NULL DEFAULT '#5A92C9',
	`accentColor` varchar(7) NOT NULL DEFAULT '#D58240',
	`footerText` text,
	`logoKey` varchar(512),
	`logoScale` int NOT NULL DEFAULT 100,
	`logoAlignment` enum('left','right') NOT NULL DEFAULT 'left',
	`defaultBcc` varchar(320),
	`invoicePrefix` varchar(24) NOT NULL DEFAULT 'WP',
	`invoiceSequence` int NOT NULL DEFAULT 1000,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `companies_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `company_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('platform_admin','company_creator','company_viewer') NOT NULL DEFAULT 'company_viewer',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `company_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `company_members_company_user_uq` UNIQUE(`companyId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`companyName` varchar(220) NOT NULL,
	`contactName` varchar(180),
	`email` varchar(320),
	`phone` varchar(64),
	`addressLine1` varchar(220),
	`addressLine2` varchar(220),
	`city` varchar(120),
	`region` varchar(120),
	`postalCode` varchar(32),
	`country` varchar(2),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`invoiceId` int,
	`provider` enum('microsoft_graph','smtp') NOT NULL,
	`status` enum('queued','sent','failed') NOT NULL DEFAULT 'queued',
	`recipient` varchar(320) NOT NULL,
	`bcc` varchar(320),
	`subject` varchar(300) NOT NULL,
	`responseSummary` text,
	`correlationId` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	CONSTRAINT `email_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_provider_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`provider` enum('microsoft_graph','smtp') NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`encryptedConfig` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`updatedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_provider_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_provider_company_uq` UNIQUE(`companyId`)
);
--> statement-breakpoint
CREATE TABLE `invoice_line_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`position` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unitPriceCents` int NOT NULL DEFAULT 0,
	`taxable` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_line_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`contactId` int NOT NULL,
	`invoiceNumber` varchar(64) NOT NULL,
	`status` enum('draft','finalized','sent','paid','void') NOT NULL DEFAULT 'draft',
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`issueDate` timestamp NOT NULL,
	`dueDate` timestamp NOT NULL,
	`taxRateBps` int NOT NULL DEFAULT 0,
	`discountRateBps` int NOT NULL DEFAULT 0,
	`subtotalCents` int NOT NULL DEFAULT 0,
	`taxCents` int NOT NULL DEFAULT 0,
	`discountCents` int NOT NULL DEFAULT 0,
	`totalCents` int NOT NULL DEFAULT 0,
	`notes` text,
	`terms` text,
	`paymentInstructions` text,
	`createdByUserId` int NOT NULL,
	`finalizedAt` timestamp,
	`sentAt` timestamp,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_company_number_uq` UNIQUE(`companyId`,`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(80) NOT NULL,
	`eventId` varchar(160),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	`status` enum('accepted','rejected','processed') NOT NULL,
	`correlationId` varchar(96) NOT NULL,
	`payloadDigest` varchar(128) NOT NULL,
	`note` varchar(500),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_members` ADD CONSTRAINT `company_members_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_members` ADD CONSTRAINT `company_members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_logs` ADD CONSTRAINT `email_logs_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_logs` ADD CONSTRAINT `email_logs_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_provider_configs` ADD CONSTRAINT `email_provider_configs_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_provider_configs` ADD CONSTRAINT `email_provider_configs_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD CONSTRAINT `invoice_line_items_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_contactId_contacts_id_fk` FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_company_created_idx` ON `audit_logs` (`companyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `company_members_user_idx` ON `company_members` (`userId`);--> statement-breakpoint
CREATE INDEX `contacts_company_idx` ON `contacts` (`companyId`);--> statement-breakpoint
CREATE INDEX `email_logs_company_created_idx` ON `email_logs` (`companyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_line_items` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `invoices_company_status_idx` ON `invoices` (`companyId`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_contact_idx` ON `invoices` (`contactId`);--> statement-breakpoint
CREATE INDEX `webhook_events_provider_created_idx` ON `webhook_events` (`provider`,`receivedAt`);