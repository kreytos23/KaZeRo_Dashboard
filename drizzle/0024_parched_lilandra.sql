ALTER TYPE "public"."tipo_saldo_favor" ADD VALUE 'anulacion';--> statement-breakpoint
ALTER TABLE "pago" DROP CONSTRAINT "pago_saldo_favor_cliente";--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" DROP CONSTRAINT "saldo_favor_signo_v2";--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" DROP CONSTRAINT "saldo_favor_pedido_requerido_v2";--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "referencia" text;--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "comprobante_clave" uuid;--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "comprobante_sha256" text;--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "anulado_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "anulacion_motivo" text;--> statement-breakpoint
ALTER TABLE "pago" ADD COLUMN "anulado_por" uuid;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD COLUMN "pago_id" uuid;--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_anulado_por_admin_id_fk" FOREIGN KEY ("anulado_por") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_mov_pago_id_pago_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pago"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pago_comprobante_sha256_uq" ON "pago" USING btree ("comprobante_sha256") WHERE "pago"."comprobante_sha256" IS NOT NULL AND "pago"."anulado_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pago_anulado_por_idx" ON "pago" USING btree ("anulado_por");--> statement-breakpoint
CREATE UNIQUE INDEX "saldo_favor_mov_pago_uq" ON "saldo_favor_mov" USING btree ("pago_id","tipo");--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_referencia_largo" CHECK ("pago"."referencia" IS NULL OR char_length(btrim("pago"."referencia")) BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_comprobante_coherente" CHECK (("pago"."comprobante_clave" IS NULL) = ("pago"."comprobante_sha256" IS NULL)
        AND ("pago"."comprobante_sha256" IS NULL OR "pago"."comprobante_sha256" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_anulacion_coherente" CHECK (("pago"."anulado_at" IS NULL AND "pago"."anulacion_motivo" IS NULL AND "pago"."anulado_por" IS NULL)
        OR ("pago"."anulado_at" IS NOT NULL AND "pago"."anulado_por" IS NOT NULL AND "pago"."anulacion_motivo" IS NOT NULL
            AND char_length(btrim("pago"."anulacion_motivo")) BETWEEN 1 AND 200));--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_pago_origen" CHECK (("saldo_favor_mov"."tipo"::text = 'anulacion' AND "saldo_favor_mov"."pago_id" IS NOT NULL)
        OR ("saldo_favor_mov"."tipo"::text <> 'anulacion' AND ("saldo_favor_mov"."pago_id" IS NULL OR "saldo_favor_mov"."tipo"::text = 'sobrante')));--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_signo_v2" CHECK (("saldo_favor_mov"."tipo"::text IN ('uso', 'retiro') AND "saldo_favor_mov"."monto" < 0) OR ("saldo_favor_mov"."tipo"::text = 'anulacion' AND "saldo_favor_mov"."monto" <> 0)
        OR ("saldo_favor_mov"."tipo"::text NOT IN ('uso', 'retiro', 'anulacion') AND "saldo_favor_mov"."monto" > 0));--> statement-breakpoint
ALTER TABLE "saldo_favor_mov" ADD CONSTRAINT "saldo_favor_pedido_requerido_v2" CHECK ("saldo_favor_mov"."tipo"::text IN ('sobrante', 'retiro', 'anulacion') OR "saldo_favor_mov"."pedido_id" IS NOT NULL);