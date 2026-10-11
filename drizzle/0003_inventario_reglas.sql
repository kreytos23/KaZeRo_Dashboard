-- Extensiones para búsqueda sin acentos y por similitud (diseño §8).
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- IMMUTABLE con diccionario explícito para poder indexarla. Debe coincidir EXACTAMENTE con normalizar()
-- de src/domain/texto.ts: unaccent → lower → colapsar cualquier espacio (incl. NBSP) → recortar.
-- La prueba "kz_normalizar coincide con normalizar() de TS" compara ambas con tabs, NBSP, ß, ø, ł.
CREATE OR REPLACE FUNCTION public.kz_normalizar(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, t)), '[\s\u00A0]+', ' ', 'g')) $$;
--> statement-breakpoint
CREATE UNIQUE INDEX categoria_nombre_uq ON categoria (kz_normalizar(nombre));
--> statement-breakpoint
CREATE UNIQUE INDEX material_nombre_uq ON material (kz_normalizar(nombre));
--> statement-breakpoint
CREATE UNIQUE INDEX proveedor_nombre_uq ON proveedor (kz_normalizar(nombre));
--> statement-breakpoint
CREATE UNIQUE INDEX vendedor_nombre_uq ON vendedor (kz_normalizar(nombre));
--> statement-breakpoint
CREATE INDEX pieza_descripcion_trgm ON pieza USING gin (kz_normalizar(descripcion) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX cliente_busqueda_trgm ON cliente USING gin (kz_normalizar(nombre || ' ' || coalesce(referencia, '')) gin_trgm_ops);
--> statement-breakpoint
-- Máquina de estados de pieza (diseño §5, R-03). Se compara como texto para no depender de casts de enums.
CREATE OR REPLACE FUNCTION public.kz_transicion_pieza_permitida(de estado_pieza, a estado_pieza) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT de = a OR (de::text || '>' || a::text) = ANY (ARRAY[
    'disponible>en_exhibidor', 'en_exhibidor>disponible',
    'disponible>apartada', 'en_exhibidor>apartada',
    'apartada>vendida', 'apartada>disponible', 'apartada>en_exhibidor',
    'disponible>regalo', 'disponible>defecto', 'disponible>guardada',
    'en_exhibidor>regalo', 'en_exhibidor>defecto', 'en_exhibidor>guardada',
    'defecto>disponible', 'guardada>disponible',
    'vendida>disponible'
  ]) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.kz_validar_transicion_pieza() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT kz_transicion_pieza_permitida(OLD.estado, NEW.estado) THEN
    -- CONSTRAINT lo expone a pgConstraint() para traducirlo a un mensaje de negocio.
    RAISE EXCEPTION 'Transición de pieza no permitida: % → %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_transicion';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pieza_transicion BEFORE UPDATE OF estado ON pieza
  FOR EACH ROW EXECUTE FUNCTION kz_validar_transicion_pieza();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON categoria, material, proveedor, vendedor, cliente, exhibidor, pieza TO kazero_app;
--> statement-breakpoint
-- R-06: el historial no se edita ni se borra.
GRANT SELECT, INSERT ON movimiento_pieza TO kazero_app;
--> statement-breakpoint
-- La columna orden (bigserial) usa una secuencia: INSERT necesita USAGE sobre ella.
GRANT USAGE ON SEQUENCE movimiento_pieza_orden_seq TO kazero_app;
--> statement-breakpoint
-- Toda FK con índice (lecciones §3): faltaba en codigo_recuperacion (Plan 1). Expand: solo se agrega.
CREATE INDEX IF NOT EXISTS codigo_recuperacion_admin_idx ON codigo_recuperacion (admin_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.kz_tocar_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER vendedor_updated_at BEFORE UPDATE ON vendedor FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
CREATE TRIGGER cliente_updated_at BEFORE UPDATE ON cliente FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
CREATE TRIGGER exhibidor_updated_at BEFORE UPDATE ON exhibidor FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
CREATE TRIGGER pieza_updated_at BEFORE UPDATE ON pieza FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
-- Vistas de solo lectura (lecciones §3): security_invoker para que apliquen los privilegios de quien consulta,
-- columnas explícitas (sin SELECT *) y agregados en la propia vista para evitar N+1.
CREATE VIEW v_catalogo WITH (security_invoker = true) AS
  SELECT 'categoria'::text AS tipo, id, nombre FROM categoria
  UNION ALL SELECT 'material'::text, id, nombre FROM material
  UNION ALL SELECT 'proveedor'::text, id, nombre FROM proveedor;
--> statement-breakpoint
CREATE VIEW v_vendedor WITH (security_invoker = true) AS
  SELECT id, nombre, tipo, comision_pct, activo, version FROM vendedor;
--> statement-breakpoint
CREATE VIEW v_cliente WITH (security_invoker = true) AS
  SELECT c.id, c.nombre, c.referencia, c.telefono, c.cumpleanos, c.red_social, c.usuario_red,
         c.vendedor_habitual_id, v.nombre AS vendedor_habitual_nombre, c.notas, c.version
  FROM cliente c
  LEFT JOIN vendedor v ON v.id = c.vendedor_habitual_id;
--> statement-breakpoint
CREATE VIEW v_pieza WITH (security_invoker = true) AS
  SELECT p.id, p.codigo, p.descripcion, p.costo, p.precio, p.fecha_alta, p.estado, p.version,
         p.categoria_id, cat.nombre AS categoria_nombre,
         p.material_id, m.nombre AS material_nombre,
         p.proveedor_id, pr.nombre AS proveedor_nombre,
         p.exhibidor_id, e.nombre AS exhibidor_nombre
  FROM pieza p
  JOIN categoria cat ON cat.id = p.categoria_id
  LEFT JOIN material m ON m.id = p.material_id
  LEFT JOIN proveedor pr ON pr.id = p.proveedor_id
  LEFT JOIN exhibidor e ON e.id = p.exhibidor_id;
--> statement-breakpoint
CREATE VIEW v_movimiento_pieza WITH (security_invoker = true) AS
  SELECT mp.id, mp.orden, mp.pieza_id, mp.tipo, mp.de_estado, mp.a_estado, mp.nota, mp.fecha,
         mp.exhibidor_id, e.nombre AS exhibidor_nombre
  FROM movimiento_pieza mp
  LEFT JOIN exhibidor e ON e.id = mp.exhibidor_id;
--> statement-breakpoint
CREATE VIEW v_exhibidor WITH (security_invoker = true) AS
  SELECT e.id, e.nombre, e.fecha_envio, e.estado, e.version, e.vendedor_id, v.nombre AS vendedor_nombre,
         coalesce(pz.n, 0)::int AS piezas_actuales
  FROM exhibidor e
  JOIN vendedor v ON v.id = e.vendedor_id
  LEFT JOIN (
    SELECT exhibidor_id, count(*) AS n FROM pieza WHERE estado = 'en_exhibidor' GROUP BY exhibidor_id
  ) pz ON pz.exhibidor_id = e.id;
--> statement-breakpoint
GRANT SELECT ON v_catalogo, v_vendedor, v_cliente, v_pieza, v_movimiento_pieza, v_exhibidor TO kazero_app;
