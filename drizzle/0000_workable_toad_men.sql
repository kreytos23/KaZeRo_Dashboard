CREATE TYPE "public"."evento_acceso" AS ENUM('login_ok', 'password_fallido', 'totp_fallido', 'bloqueado', 'logout', 'logout_todos', 'codigo_recuperacion_usado');--> statement-breakpoint
CREATE TYPE "public"."nivel_sesion" AS ENUM('pre_mfa', 'completa');--> statement-breakpoint
CREATE TYPE "public"."rol_admin" AS ENUM('admin');--> statement-breakpoint
CREATE TABLE "acceso_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"evento" "evento_acceso" NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_cifrado" text NOT NULL,
	"totp_ultimo_paso" bigint DEFAULT 0 NOT NULL,
	"rol" "rol_admin" DEFAULT 'admin' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codigo_recuperacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"usado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotencia" (
	"key" uuid PRIMARY KEY NOT NULL,
	"operacion" text NOT NULL,
	"payload_hash" text NOT NULL,
	"resultado" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"admin_id" uuid NOT NULL,
	"nivel" "nivel_sesion" NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"ultimo_uso_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"revocada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codigo_recuperacion" ADD CONSTRAINT "codigo_recuperacion_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion" ADD CONSTRAINT "sesion_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acceso_log_email_fecha_idx" ON "acceso_log" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "acceso_log_fecha_idx" ON "acceso_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_email_uq" ON "admin" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "codigo_recuperacion_hash_uq" ON "codigo_recuperacion" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sesion_token_hash_uq" ON "sesion" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sesion_admin_idx" ON "sesion" USING btree ("admin_id");