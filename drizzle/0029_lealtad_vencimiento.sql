-- L-7 (2026-11-24): la tarjeta vence tras 6 meses sin comprar. Sin notas, la última compra es el día en que se
-- registraron las compras previas. Todo corre en la transacción de la migración: el ALTER TABLE toma el lock de
-- cliente hasta el final, así que ninguna escritura se cuela entre el backfill y el CHECK.
-- 1. La columna (nullable, sin default: no reescribe la tabla).
ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "compras_previas_fecha" date;
--> statement-breakpoint
-- 2. Backfill antes del CHECK: las tarjetas de papel se cargaron el 2026-11-17.
UPDATE cliente SET compras_previas_fecha = DATE '2026-11-17'
  WHERE compras_previas > 0 AND compras_previas_fecha IS NULL;
--> statement-breakpoint
-- 3. La fecha la pone la BD, no la app: al dar de alta con previas (importación) y cada vez que cambia el número
--    (una corrección desde la ficha la renueva). En 0 queda NULL. Fecha de negocio en horario de México.
CREATE OR REPLACE FUNCTION public.kz_fecha_compras_previas() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  NEW.compras_previas_fecha := CASE WHEN NEW.compras_previas > 0
    THEN (now() AT TIME ZONE 'America/Mexico_City')::date END;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_fecha_compras_previas() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS cliente_previas_fecha_alta ON cliente;
--> statement-breakpoint
CREATE TRIGGER cliente_previas_fecha_alta BEFORE INSERT ON cliente
  FOR EACH ROW EXECUTE FUNCTION kz_fecha_compras_previas();
--> statement-breakpoint
-- Si cliente_compras_previas (0028) rechaza el cambio, la sentencia entera se revierte, fecha incluida.
DROP TRIGGER IF EXISTS cliente_previas_fecha ON cliente;
--> statement-breakpoint
CREATE TRIGGER cliente_previas_fecha BEFORE UPDATE OF compras_previas ON cliente
  FOR EACH ROW WHEN (OLD.compras_previas IS DISTINCT FROM NEW.compras_previas)
  EXECUTE FUNCTION kz_fecha_compras_previas();
--> statement-breakpoint
-- 4. Con el backfill hecho, toda clienta con previas tiene fecha. Idempotente, como la columna.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cliente_previas_con_fecha' AND conrelid = 'public.cliente'::regclass
  ) THEN
    ALTER TABLE "cliente" ADD CONSTRAINT "cliente_previas_con_fecha" CHECK ("cliente"."compras_previas" = 0 OR "cliente"."compras_previas_fecha" IS NOT NULL);
  END IF;
END
$$;
--> statement-breakpoint
-- 5. v_cliente de 0028 con compras_previas_fecha al final (CREATE OR REPLACE solo admite columnas nuevas al final).
--    kazero_app ya tiene SELECT sobre v_cliente y cliente (0003) y no recibe UPDATE de la columna: la escribe el
--    trigger. La auditoría sigue registrando compras_previas, que es lo que cambia la persona; la fecha se deriva.
CREATE OR REPLACE VIEW v_cliente WITH (security_invoker = true) AS
  SELECT c.id, c.nombre, c.referencia, c.telefono, c.cumpleanos, c.red_social, c.usuario_red,
         c.vendedor_habitual_id, v.nombre AS vendedor_habitual_nombre, c.notas, c.version,
         c.es_mostrador, c.compras_previas, c.compras_previas_fecha
  FROM cliente c
  LEFT JOIN vendedor v ON v.id = c.vendedor_habitual_id;
