CREATE TABLE `application_settings` (
	`key` varchar(96) NOT NULL,
	`encryptedValue` text,
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `application_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `application_settings` ADD CONSTRAINT `application_settings_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;