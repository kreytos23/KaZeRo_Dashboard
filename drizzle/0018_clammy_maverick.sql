CREATE TYPE "public"."metodo_pago_comision" AS ENUM('efectivo', 'transferencia', 'otro');--> statement-breakpoint
CREATE TABLE "comision_linea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corte_id" uuid NOT NULL,
	"vendedor_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"fecha_liquidacion" date NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	CONSTRAINT "comision_linea_base" CHECK ("comision_linea"."base" >= 0),
	CONSTRAINT "comision_linea_pct" CHECK ("comision_linea"."pct" >= 0 AND "comision_linea"."pct" <= 100),
	CONSTRAINT "comision_linea_monto" CHECK ("comision_linea"."monto" >= 0 AND "comision_linea"."monto" <= "comision_linea"."base")
);
--> statement-breakpoint
CREATE TABLE "corte_comision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mes" date NOT NULL,
	"cerrado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_id" uuid NOT NULL,
	CONSTRAINT "corte_comision_mes_inicio" CHECK (extract(day from "corte_comision"."mes") = 1)
);
--> statement-breakpoint
CREATE TABLE "pago_comision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corte_id" uuid NOT NULL,
	"vendedor_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"metodo" "metodo_pago_comision" NOT NULL,
	"nota" text,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anulado_at" timestamp with time zone,
	"anulacion_motivo" text,
	"anulado_por" uuid,
	CONSTRAINT "pago_comision_monto" CHECK ("pago_comision"."monto" > 0),
	CONSTRAINT "pago_comision_nota" CHECK ("pago_comision"."nota" IS NULL OR char_length("pago_comision"."nota") <= 200),
	CONSTRAINT "pago_comision_anulacion" CHECK (("pago_comision"."anulado_at" IS NULL AND "pago_comision"."anulacion_motivo" IS NULL AND "pago_comision"."anulado_por" IS NULL)
    OR ("pago_comision"."anulado_at" IS NOT NULL AND "pago_comision"."anulado_por" IS NOT NULL AND char_length(btrim("pago_comision"."anulacion_motivo")) BETWEEN 1 AND 200))
);
--> statement-breakpoint
ALTER TABLE "comision_linea" ADD CONSTRAINT "comision_linea_corte_id_corte_comision_id_fk" FOREIGN KEY ("corte_id") REFERENCES "public"."corte_comision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision_linea" ADD CONSTRAINT "comision_linea_vendedor_id_vendedor_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comision_linea" ADD CONSTRAINT "comision_linea_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corte_comision" ADD CONSTRAINT "corte_comision_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_comision" ADD CONSTRAINT "pago_comision_corte_id_corte_comision_id_fk" FOREIGN KEY ("corte_id") REFERENCES "public"."corte_comision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_comision" ADD CONSTRAINT "pago_comision_vendedor_id_vendedor_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_comision" ADD CONSTRAINT "pago_comision_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_comision" ADD CONSTRAINT "pago_comision_anulado_por_admin_id_fk" FOREIGN KEY ("anulado_por") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comision_linea_pedido_uq" ON "comision_linea" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "comision_linea_corte_vendedor_idx" ON "comision_linea" USING btree ("corte_id","vendedor_id");--> statement-breakpoint
CREATE INDEX "comision_linea_vendedor_idx" ON "comision_linea" USING btree ("vendedor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corte_comision_mes_uq" ON "corte_comision" USING btree ("mes");--> statement-breakpoint
CREATE INDEX "corte_comision_admin_idx" ON "corte_comision" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pago_comision_vigente_uq" ON "pago_comision" USING btree ("corte_id","vendedor_id") WHERE "pago_comision"."anulado_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pago_comision_vendedor_idx" ON "pago_comision" USING btree ("vendedor_id");--> statement-breakpoint
CREATE INDEX "pago_comision_admin_idx" ON "pago_comision" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "pago_comision_anulado_por_idx" ON "pago_comision" USING btree ("anulado_por");--> statement-breakpoint
CREATE INDEX "acceso_log_ip_idx" ON "acceso_log" USING btree ("ip","created_at");