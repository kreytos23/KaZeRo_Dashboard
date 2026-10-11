CREATE TYPE "public"."entidad_auditoria" AS ENUM('pieza', 'vendedor', 'cliente', 'exhibidor', 'categoria', 'material', 'proveedor');--> statement-breakpoint
ALTER TYPE "public"."tipo_movimiento" ADD VALUE 'correccion';--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"orden" bigserial NOT NULL,
	"entidad" "entidad_auditoria" NOT NULL,
	"entidad_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"motivo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auditoria_motivo_largo" CHECK ("auditoria"."motivo" IS NULL OR char_length(btrim("auditoria"."motivo")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "auditoria_campo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auditoria_id" uuid NOT NULL,
	"posicion" smallint NOT NULL,
	"campo" text NOT NULL,
	"antes" text,
	"despues" text,
	CONSTRAINT "auditoria_campo_nombre" CHECK ("auditoria_campo"."campo" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "auditoria_campo_posicion" CHECK ("auditoria_campo"."posicion" BETWEEN 1 AND 50),
	CONSTRAINT "auditoria_campo_largo" CHECK (("auditoria_campo"."antes" IS NULL OR char_length("auditoria_campo"."antes") <= 2000) AND ("auditoria_campo"."despues" IS NULL OR char_length("auditoria_campo"."despues") <= 2000)),
	CONSTRAINT "auditoria_campo_cambia" CHECK ("auditoria_campo"."antes" IS DISTINCT FROM "auditoria_campo"."despues")
);
--> statement-breakpoint
ALTER TABLE "categoria" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "categoria" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD COLUMN "admin_id" uuid;--> statement-breakpoint
ALTER TABLE "proveedor" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proveedor" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria_campo" ADD CONSTRAINT "auditoria_campo_auditoria_id_auditoria_id_fk" FOREIGN KEY ("auditoria_id") REFERENCES "public"."auditoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_entidad_idx" ON "auditoria" USING btree ("entidad","entidad_id","orden");--> statement-breakpoint
CREATE INDEX "auditoria_admin_idx" ON "auditoria" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auditoria_campo_uq" ON "auditoria_campo" USING btree ("auditoria_id","posicion");--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD CONSTRAINT "movimiento_pieza_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movimiento_pieza_admin_idx" ON "movimiento_pieza" USING btree ("admin_id");--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD CONSTRAINT "movimiento_correccion_completa" CHECK ("movimiento_pieza"."tipo"::text <> 'correccion' OR ("movimiento_pieza"."admin_id" IS NOT NULL AND char_length(btrim(coalesce("movimiento_pieza"."nota", ''))) >= 1));