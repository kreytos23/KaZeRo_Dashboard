CREATE TYPE "public"."estado_exhibidor" AS ENUM('abierto', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."estado_pieza" AS ENUM('disponible', 'en_exhibidor', 'apartada', 'vendida', 'regalo', 'defecto', 'guardada');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento" AS ENUM('alta', 'envio_exhibidor', 'regreso', 'venta', 'cancelacion_venta', 'cambio_estado');--> statement-breakpoint
CREATE TYPE "public"."tipo_vendedor" AS ENUM('casa', 'revendedora', 'consignacion');--> statement-breakpoint
CREATE TABLE "categoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categoria_nombre_largo" CHECK (char_length(btrim("categoria"."nombre")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"referencia" text,
	"telefono" text,
	"cumpleanos" date,
	"red_social" text,
	"usuario_red" text,
	"vendedor_habitual_id" uuid,
	"notas" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cliente_nombre_largo" CHECK (char_length(btrim("cliente"."nombre")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "exhibidor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendedor_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"fecha_envio" date NOT NULL,
	"estado" "estado_exhibidor" DEFAULT 'abierto' NOT NULL,
	"cerrado_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibidor_nombre_largo" CHECK (char_length(btrim("exhibidor"."nombre")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_nombre_largo" CHECK (char_length(btrim("material"."nombre")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "movimiento_pieza" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"orden" bigserial NOT NULL,
	"pieza_id" uuid NOT NULL,
	"tipo" "tipo_movimiento" NOT NULL,
	"de_estado" "estado_pieza",
	"a_estado" "estado_pieza" NOT NULL,
	"exhibidor_id" uuid,
	"pedido_id" uuid,
	"nota" text,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimiento_nota_largo" CHECK ("movimiento_pieza"."nota" IS NULL OR char_length("movimiento_pieza"."nota") <= 200)
);
--> statement-breakpoint
CREATE TABLE "pieza" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"categoria_id" uuid NOT NULL,
	"material_id" uuid,
	"proveedor_id" uuid,
	"descripcion" text NOT NULL,
	"costo" numeric(12, 2) DEFAULT '0' NOT NULL,
	"precio" numeric(12, 2) NOT NULL,
	"fecha_alta" date NOT NULL,
	"foto_path" text,
	"estado" "estado_pieza" DEFAULT 'disponible' NOT NULL,
	"exhibidor_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pieza_codigo_formato" CHECK ("pieza"."codigo" ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
	CONSTRAINT "pieza_descripcion_largo" CHECK (char_length(btrim("pieza"."descripcion")) BETWEEN 1 AND 300),
	CONSTRAINT "pieza_montos" CHECK ("pieza"."costo" >= 0 AND "pieza"."precio" >= 0),
	CONSTRAINT "pieza_exhibidor_coherente" CHECK ("pieza"."estado" <> 'en_exhibidor' OR "pieza"."exhibidor_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "proveedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proveedor_nombre_largo" CHECK (char_length(btrim("proveedor"."nombre")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "vendedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_vendedor" NOT NULL,
	"comision_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendedor_nombre_largo" CHECK (char_length(btrim("vendedor"."nombre")) BETWEEN 1 AND 80),
	CONSTRAINT "vendedor_comision_rango" CHECK ("vendedor"."comision_pct" >= 0 AND "vendedor"."comision_pct" <= 100)
);
--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_vendedor_habitual_id_vendedor_id_fk" FOREIGN KEY ("vendedor_habitual_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibidor" ADD CONSTRAINT "exhibidor_vendedor_id_vendedor_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."vendedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD CONSTRAINT "movimiento_pieza_pieza_id_pieza_id_fk" FOREIGN KEY ("pieza_id") REFERENCES "public"."pieza"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_pieza" ADD CONSTRAINT "movimiento_pieza_exhibidor_id_exhibidor_id_fk" FOREIGN KEY ("exhibidor_id") REFERENCES "public"."exhibidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_proveedor_id_proveedor_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_exhibidor_id_exhibidor_id_fk" FOREIGN KEY ("exhibidor_id") REFERENCES "public"."exhibidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cliente_vendedor_habitual_idx" ON "cliente" USING btree ("vendedor_habitual_id");--> statement-breakpoint
CREATE INDEX "exhibidor_vendedor_idx" ON "exhibidor" USING btree ("vendedor_id");--> statement-breakpoint
CREATE INDEX "movimiento_pieza_pieza_idx" ON "movimiento_pieza" USING btree ("pieza_id","orden");--> statement-breakpoint
CREATE INDEX "movimiento_pieza_exhibidor_idx" ON "movimiento_pieza" USING btree ("exhibidor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pieza_codigo_uq" ON "pieza" USING btree ("codigo");--> statement-breakpoint
CREATE INDEX "pieza_estado_idx" ON "pieza" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "pieza_categoria_idx" ON "pieza" USING btree ("categoria_id");--> statement-breakpoint
CREATE INDEX "pieza_material_idx" ON "pieza" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "pieza_proveedor_idx" ON "pieza" USING btree ("proveedor_id");--> statement-breakpoint
CREATE INDEX "pieza_exhibidor_idx" ON "pieza" USING btree ("exhibidor_id");