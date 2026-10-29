CREATE TABLE `auth_login_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stateHash` varchar(64) NOT NULL,
	`nonce` varchar(128) NOT NULL,
	`codeVerifier` varchar(160) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_login_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_login_transactions_state_hash_uq` UNIQUE(`stateHash`)
);
--> statement-breakpoint
CREATE TABLE `user_recovery_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_recovery_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`csrfHash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`sessionVersion` int NOT NULL,
	`stage` enum('full','password_change','mfa_setup','mfa_verify') NOT NULL DEFAULT 'full',
	`authMethod` enum('local','entra') NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_sessions_token_hash_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `normalizedEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `users` ADD `authProvider` enum('local','entra','hybrid') DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `accountStatus` enum('active','disabled','invited') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `mustChangePassword` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfaRequired` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfaEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfaSecretEncrypted` text;--> statement-breakpoint
ALTER TABLE `users` ADD `mfaEnrolledAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `entraTenantId` varchar(96);--> statement-breakpoint
ALTER TABLE `users` ADD `entraObjectId` varchar(96);--> statement-breakpoint
ALTER TABLE `users` ADD `sessionVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `users` SET `normalizedEmail` = LOWER(TRIM(`email`)) WHERE `email` IS NOT NULL AND TRIM(`email`) <> '';--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_normalized_email_uq` UNIQUE(`normalizedEmail`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_entra_subject_uq` UNIQUE(`entraTenantId`,`entraObjectId`);--> statement-breakpoint
ALTER TABLE `user_recovery_codes` ADD CONSTRAINT `user_recovery_codes_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auth_login_transactions_expiry_idx` ON `auth_login_transactions` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `user_recovery_codes_user_idx` ON `user_recovery_codes` (`userId`);--> statement-breakpoint
CREATE INDEX `user_sessions_user_idx` ON `user_sessions` (`userId`);
