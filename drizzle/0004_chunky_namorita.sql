ALTER TABLE "cliente" ADD CONSTRAINT "cliente_referencia_largo" CHECK ("cliente"."referencia" IS NULL OR char_length("cliente"."referencia") <= 120);--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_telefono_largo" CHECK ("cliente"."telefono" IS NULL OR char_length("cliente"."telefono") <= 30);--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_red_social_largo" CHECK ("cliente"."red_social" IS NULL OR char_length("cliente"."red_social") <= 40);--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_usuario_red_largo" CHECK ("cliente"."usuario_red" IS NULL OR char_length("cliente"."usuario_red") <= 80);--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_notas_largo" CHECK (char_length("cliente"."notas") <= 2000);--> statement-breakpoint
ALTER TABLE "exhibidor" ADD CONSTRAINT "exhibidor_cierre_coherente" CHECK (("exhibidor"."estado" = 'cerrado') = ("exhibidor"."cerrado_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_exhibidor_solo_si_aplica" CHECK ("pieza"."estado" IN ('en_exhibidor', 'apartada') OR "pieza"."exhibidor_id" IS NULL);--> statement-breakpoint
ALTER TABLE "pieza" ADD CONSTRAINT "pieza_foto_path_largo" CHECK ("pieza"."foto_path" IS NULL OR char_length("pieza"."foto_path") <= 500);