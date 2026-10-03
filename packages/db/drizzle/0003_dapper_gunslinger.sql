CREATE TABLE "alert_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stop_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
