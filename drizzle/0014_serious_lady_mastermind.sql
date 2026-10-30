CREATE TABLE `backup_destinations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(160) NOT NULL,
	`provider` enum('s3','sharepoint') NOT NULL,
	`encryptedConfig` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastVerifiedAt` timestamp,
	`lastVerificationSummary` varchar(500),
	`createdByUserId` int NOT NULL,
	`updatedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `backup_destinations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`destinationId` int,
	`initiatedByUserId` int,
	`operation` enum('local_export','destination_test','cloud_backup') NOT NULL,
	`status` enum('queued','succeeded','failed') NOT NULL DEFAULT 'queued',
	`filename` varchar(320),
	`archiveLocation` varchar(1000),
	`checksumSha256` varchar(64),
	`sizeBytes` int,
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `backup_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`subjectTemplate` varchar(300) NOT NULL,
	`htmlBodyTemplate` text NOT NULL,
	`updatedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_templates_company_uq` UNIQUE(`companyId`)
);
--> statement-breakpoint
ALTER TABLE `email_logs` ADD `attemptType` enum('initial','resend','test') DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_destinations` ADD CONSTRAINT `backup_destinations_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backup_destinations` ADD CONSTRAINT `backup_destinations_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backup_runs` ADD CONSTRAINT `backup_runs_destinationId_backup_destinations_id_fk` FOREIGN KEY (`destinationId`) REFERENCES `backup_destinations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backup_runs` ADD CONSTRAINT `backup_runs_initiatedByUserId_users_id_fk` FOREIGN KEY (`initiatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_templates` ADD CONSTRAINT `email_templates_companyId_companies_id_fk` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_templates` ADD CONSTRAINT `email_templates_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `backup_destinations_active_idx` ON `backup_destinations` (`isActive`);--> statement-breakpoint
CREATE INDEX `backup_runs_created_idx` ON `backup_runs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `backup_runs_destination_idx` ON `backup_runs` (`destinationId`);