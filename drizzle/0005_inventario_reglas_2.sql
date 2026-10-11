-- Una pieza en exhibidor no cambia de exhibidor sin pasar por "regreso", y el trigger también vigila exhibidor_id.
CREATE OR REPLACE FUNCTION public.kz_validar_transicion_pieza() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT kz_transicion_pieza_permitida(OLD.estado, NEW.estado) THEN
    RAISE EXCEPTION 'Transición de pieza no permitida: % → %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_transicion';
  END IF;
  -- Una pieza en exhibidor no cambia de exhibidor sin pasar por "regreso" (queda en el historial).
  IF OLD.estado = 'en_exhibidor' AND NEW.estado = 'en_exhibidor' AND NEW.exhibidor_id IS DISTINCT FROM OLD.exhibidor_id THEN
    RAISE EXCEPTION 'La pieza debe regresar antes de cambiar de exhibidor'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_cambio_exhibidor';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER pieza_transicion ON pieza;
--> statement-breakpoint
CREATE TRIGGER pieza_transicion BEFORE UPDATE OF estado, exhibidor_id ON pieza
  FOR EACH ROW EXECUTE FUNCTION kz_validar_transicion_pieza();
--> statement-breakpoint
-- Paridad con normalizar() de TS: clase de espacios explícita en ambos lados (el \s de JS y el de Postgres difieren).
CREATE OR REPLACE FUNCTION public.kz_normalizar(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, t)), '[ \t\n\r\f\v\u00A0]+', ' ', 'g')) $$;
--> statement-breakpoint
-- La función cambió: los índices que la usan se reconstruyen.
REINDEX INDEX categoria_nombre_uq;
--> statement-breakpoint
REINDEX INDEX material_nombre_uq;
--> statement-breakpoint
REINDEX INDEX proveedor_nombre_uq;
--> statement-breakpoint
REINDEX INDEX vendedor_nombre_uq;
--> statement-breakpoint
REINDEX INDEX pieza_descripcion_trgm;
--> statement-breakpoint
REINDEX INDEX cliente_busqueda_trgm;
