ALTER TABLE "cliente" ADD COLUMN "compras_previas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_compras_previas_rango" CHECK ("cliente"."compras_previas" BETWEEN 0 AND 9);--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_mostrador_sin_previas" CHECK (NOT "cliente"."es_mostrador" OR "cliente"."compras_previas" = 0);