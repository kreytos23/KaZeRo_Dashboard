CREATE TYPE "public"."metodo_entrega" AS ENUM('efectivo', 'transferencia', 'otro');--> statement-breakpoint
CREATE TYPE "public"."tipo_entrega_exhibidor" AS ENUM('entrega', 'ajuste');--> statement-breakpoint
CREATE TABLE "entrega_exhibidor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exhibidor_id" uuid NOT NULL,
	"tipo" "tipo_entrega_exhibidor" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"fecha" date NOT NULL,
	"metodo" "metodo_entrega",
	"nota" text,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entrega_exhibidor_monto" CHECK (("entrega_exhibidor"."tipo" = 'entrega' AND "entrega_exhibidor"."monto" > 0) OR ("entrega_exhibidor"."tipo" = 'ajuste' AND "entrega_exhibidor"."monto" <> 0)),
	CONSTRAINT "entrega_exhibidor_metodo" CHECK (("entrega_exhibidor"."tipo" = 'entrega') = ("entrega_exhibidor"."metodo" IS NOT NULL)),
	CONSTRAINT "entrega_exhibidor_nota" CHECK ("entrega_exhibidor"."nota" IS NULL OR char_length("entrega_exhibidor"."nota") <= 200),
	CONSTRAINT "entrega_exhibidor_ajuste_motivo" CHECK ("entrega_exhibidor"."tipo" <> 'ajuste' OR ("entrega_exhibidor"."nota" IS NOT NULL AND char_length(btrim("entrega_exhibidor"."nota")) BETWEEN 1 AND 200))
);
--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "es_mostrador" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "exhibidor_id" uuid;--> statement-breakpoint
ALTER TABLE "entrega_exhibidor" ADD CONSTRAINT "entrega_exhibidor_exhibidor_id_exhibidor_id_fk" FOREIGN KEY ("exhibidor_id") REFERENCES "public"."exhibidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrega_exhibidor" ADD CONSTRAINT "entrega_exhibidor_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entrega_exhibidor_exhibidor_idx" ON "entrega_exhibidor" USING btree ("exhibidor_id","fecha");--> statement-breakpoint
CREATE INDEX "entrega_exhibidor_admin_idx" ON "entrega_exhibidor" USING btree ("admin_id");--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_exhibidor_id_exhibidor_id_fk" FOREIGN KEY ("exhibidor_id") REFERENCES "public"."exhibidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_mostrador_uq" ON "cliente" USING btree ("es_mostrador") WHERE "cliente"."es_mostrador";--> statement-breakpoint
CREATE INDEX "pago_exhibidor_idx" ON "pago" USING btree ("exhibidor_id");--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_exhibidor_sin_saldo" CHECK ("pago"."exhibidor_id" IS NULL OR "pago"."metodo"::text <> 'saldo_favor');