ALTER TYPE "public"."tipo_movimiento" ADD VALUE 'entrega_vendedora';--> statement-breakpoint
ALTER TYPE "public"."tipo_movimiento" ADD VALUE 'regreso_vendedora';--> statement-breakpoint
ALTER TYPE "public"."tipo_movimiento" ADD VALUE 'devolucion';--> statement-breakpoint
ALTER TYPE "public"."metodo_pago" ADD VALUE 'saldo_favor';--> statement-breakpoint
ALTER TYPE "public"."tipo_saldo_favor" ADD VALUE 'devolucion';--> statement-breakpoint
ALTER TYPE "public"."tipo_saldo_favor" ADD VALUE 'retiro';--> statement-breakpoint
CREATE TABLE "devolucion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_item_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"motivo" text NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devolucion_monto_positivo" CHECK ("devolucion"."monto" > 0),
	CONSTRAINT "devolucion_motivo_largo" CHECK (char_length(btrim("devolucion"."motivo")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" DROP CONSTRAINT "saldo_favor_signo";--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD COLUMN "vendedor_id" uuid;--> statement-breakpoint
ALTER TABLE "pieza" ADD COLUMN "vendedor_custodia_id" uuid;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD COLUMN "aplicacion_pago_id" uuid;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD COLUMN "devolucion_id" uuid;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD COLUMN "admin_id" uuid;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD COLUMN "nota" text;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_pedido_item_id_pedido_item_id_fk" FOREIGN KEY ("pedido_item_id") REFERENCES "public"."pedido_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devolucion_pedido_item_uq" ON "devolucion" USING btree ("pedido_item_id");--> statement-breakpoint
CREATE INDEX "devolucion_admin_idx" ON "devolucion" USING btree ("admin_id");--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD CONSTRAINT "movimiento_pieza_vendedor_id_vendedor_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_vendedor_custodia_id_vendedor_id_fk" FOREIGN KEY ("vendedor_custodia_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_mov_aplicacion_pago_id_aplicacion_pago_id_fk" FOREIGN KEY ("aplicacion_pago_id") REFERENCES "public"."aplicacion_pago"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_mov_devolucion_id_devolucion_id_fk" FOREIGN KEY ("devolucion_id") REFERENCES "public"."devolucion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_mov_admin_id_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movimiento_pieza_vendedor_idx" ON "movimiento_pieza" USING btree ("vendedor_id");--> statement-breakpoint
CREATE INDEX "pieza_vendedor_custodia_idx" ON "pieza" USING btree ("vendedor_custodia_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saldo_favor_mov_aplicacion_uq" ON "saldo_favor_mov" USING btree ("aplicacion_pago_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saldo_favor_mov_devolucion_uq" ON "saldo_favor_mov" USING btree ("devolucion_id");--> statement-breakpoint
CREATE INDEX "saldo_favor_mov_admin_idx" ON "saldo_favor_mov" USING btree ("admin_id");--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_una_ubicacion" CHECK (num_nonnulls("pieza"."exhibidor_id", "pieza"."vendedor_custodia_id") <= 1);--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_custodia_solo_si_aplica" CHECK ("pieza"."estado" IN ('disponible', 'apartada') OR "pieza"."vendedor_custodia_id" IS NULL);--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_saldo_favor_cliente" CHECK ("pago"."metodo"::text <> 'saldo_favor' OR "pago"."pagador_cliente_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_signo_v2" CHECK (("saldo_favor_mov"."tipo"::text IN ('uso', 'retiro') AND "saldo_favor_mov"."monto" < 0) OR ("saldo_favor_mov"."tipo"::text NOT IN ('uso', 'retiro') AND "saldo_favor_mov"."monto" > 0));--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_pedido_requerido_v2" CHECK ("saldo_favor_mov"."tipo"::text IN ('sobrante', 'retiro') OR "saldo_favor_mov"."pedido_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_origen" CHECK (("saldo_favor_mov"."tipo"::text = 'uso') = ("saldo_favor_mov"."aplicacion_pago_id" IS NOT NULL) AND ("saldo_favor_mov"."tipo"::text = 'devolucion') = ("saldo_favor_mov"."devolucion_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_retiro_completo" CHECK ("saldo_favor_mov"."tipo"::text <> 'retiro' OR ("saldo_favor_mov"."admin_id" IS NOT NULL AND char_length(btrim(coalesce("saldo_favor_mov"."nota", ''))) BETWEEN 1 AND 200));--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_nota_largo" CHECK ("saldo_favor_mov"."nota" IS NULL OR char_length("saldo_favor_mov"."nota") <= 200);