CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `classrooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`student_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`points` integer NOT NULL,
	`date` text NOT NULL,
	`created_at` text NOT NULL,
	`operator` text NOT NULL,
	`voided_at` text,
	`void_reason` text,
	`voided_by` text,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_date` ON `entries` (`date`);--> statement-breakpoint
CREATE INDEX `entries_student_date` ON `entries` (`student_id`,`date`);--> statement-breakpoint
CREATE INDEX `entries_batch` ON `entries` (`batch_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`number` text NOT NULL,
	`name` text NOT NULL,
	`group_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_class_number` ON `students` (`class_id`,`number`);