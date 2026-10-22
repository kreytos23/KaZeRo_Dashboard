CREATE TABLE "origen_excel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lote" text NOT NULL,
	"clave" text NOT NULL,
	"hoja" text NOT NULL,
	"filas" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"hash_contenido" text NOT NULL,
	"datos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"categoria_id" uuid,
	"material_id" uuid,
	"proveedor_id" uuid,
	"vendedor_id" uuid,
	"cliente_id" uuid,
	"exhibidor_id" uuid,
	"pieza_id" uuid,
	"pedido_id" uuid,
	"pago_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "origen_excel_lote_formato" CHECK ("origen_excel"."lote" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "origen_excel_clave_largo" CHECK (char_length("origen_excel"."clave") BETWEEN 1 AND 200),
	CONSTRAINT "origen_excel_hoja_largo" CHECK (char_length("origen_excel"."hoja") BETWEEN 1 AND 60),
	CONSTRAINT "origen_excel_hash_formato" CHECK ("origen_excel"."hash_contenido" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "origen_excel_una_entidad" CHECK (num_nonnulls("origen_excel"."categoria_id", "origen_excel"."material_id", "origen_excel"."proveedor_id", "origen_excel"."vendedor_id", "origen_excel"."cliente_id", "origen_excel"."exhibidor_id", "origen_excel"."pieza_id", "origen_excel"."pedido_id", "origen_excel"."pago_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_proveedor_id_proveedor_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_vendedor_id_vendedor_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_exhibidor_id_exhibidor_id_fk" FOREIGN KEY ("exhibidor_id") REFERENCES "public"."exhibidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_pieza_id_pieza_id_fk" FOREIGN KEY ("pieza_id") REFERENCES "public"."pieza"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origen_excel" ADD CONSTRAINT "origen_excel_pago_id_pago_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pago"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "origen_excel_clave_uq" ON "origen_excel" USING btree ("lote","clave");--> statement-breakpoint
CREATE INDEX "origen_excel_categoria_idx" ON "origen_excel" USING btree ("categoria_id") WHERE "origen_excel"."categoria_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_material_idx" ON "origen_excel" USING btree ("material_id") WHERE "origen_excel"."material_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_proveedor_idx" ON "origen_excel" USING btree ("proveedor_id") WHERE "origen_excel"."proveedor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_vendedor_idx" ON "origen_excel" USING btree ("vendedor_id") WHERE "origen_excel"."vendedor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_cliente_idx" ON "origen_excel" USING btree ("cliente_id") WHERE "origen_excel"."cliente_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_exhibidor_idx" ON "origen_excel" USING btree ("exhibidor_id") WHERE "origen_excel"."exhibidor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_pieza_idx" ON "origen_excel" USING btree ("pieza_id") WHERE "origen_excel"."pieza_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_pedido_idx" ON "origen_excel" USING btree ("pedido_id") WHERE "origen_excel"."pedido_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "origen_excel_pago_idx" ON "origen_excel" USING btree ("pago_id") WHERE "origen_excel"."pago_id" IS NOT NULL;