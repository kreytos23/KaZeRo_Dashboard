-- Plan 2.1: bitácora de ediciones (R-08, R-09) y corrección de estado (R-07).
-- OJO: 0008 agrega 'correccion' a tipo_movimiento con ADD VALUE y el migrador de Drizzle aplica todas las
-- migraciones pendientes en UNA transacción: aquí ese valor nunca se usa como literal del enum (55P04).
-- Se compara como texto o dentro de plpgsql (que resuelve en ejecución).

-- 1. Bitácora. La escribe solo este trigger: SECURITY DEFINER porque kazero_app no tiene INSERT en
--    auditoria/auditoria_campo (no puede fabricar ni omitir entradas). search_path fijo por seguridad.
--    Argumentos: columnas auditadas; 'col>tabla' = llave foránea, se guarda el nombre de esa tabla.
--    Contexto: los servicios lo fijan con set_config('kazero.admin_id' | 'kazero.motivo', …, true) DENTRO de
--    db.transaction. El tercer argumento (true) lo hace local a la transacción: se borra en COMMIT/ROLLBACK y
--    no se filtra a otra petición que reutilice la conexión del pool. Nunca uses is_local = false ni SET.
CREATE OR REPLACE FUNCTION public.kz_auditar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  viejo jsonb := to_jsonb(OLD);
  nuevo jsonb := to_jsonb(NEW);
  -- Contexto de la transacción (fijarContextoAuditoria, set_config(…, true)): se borra al terminar.
  quien_tx text := current_setting('kazero.admin_id', true);
  quien uuid;
  motivo_tx text := nullif(btrim(coalesce(current_setting('kazero.motivo', true), '')), '');
  cabecera uuid;
  columna text;
  tabla text;
  campo_tx text;
  antes text;
  despues text;
BEGIN
  -- Un valor que no es uuid cuenta como contexto ausente (auditoria_sin_admin), no como 22P02.
  IF quien_tx ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    quien := quien_tx::uuid;
  END IF;
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    columna := split_part(TG_ARGV[i], '>', 1);
    tabla := nullif(split_part(TG_ARGV[i], '>', 2), '');
    antes := viejo ->> columna;
    despues := nuevo ->> columna;
    CONTINUE WHEN antes IS NOT DISTINCT FROM despues;
    campo_tx := CASE WHEN tabla IS NULL THEN columna ELSE regexp_replace(columna, '_id$', '') END;
    IF quien IS NULL THEN
      RAISE EXCEPTION 'Edición sin contexto de auditoría'
        USING ERRCODE = 'P0001', CONSTRAINT = 'auditoria_sin_admin';
    END IF;
    -- R-09. DEBE coincidir con CAMPOS_DINERO de src/domain/auditoria.ts.
    IF campo_tx IN ('costo', 'precio', 'comision_pct') AND motivo_tx IS NULL THEN
      RAISE EXCEPTION 'Falta el motivo de un cambio de dinero'
        USING ERRCODE = 'P0001', CONSTRAINT = 'auditoria_motivo_dinero';
    END IF;
    IF tabla IS NOT NULL THEN
      -- Llave foránea: foto histórica con el nombre vigente en este momento, no el uuid.
      IF antes IS NOT NULL THEN
        EXECUTE format('SELECT nombre FROM public.%I WHERE id = $1', tabla) INTO antes USING antes::uuid;
      END IF;
      IF despues IS NOT NULL THEN
        EXECUTE format('SELECT nombre FROM public.%I WHERE id = $1', tabla) INTO despues USING despues::uuid;
      END IF;
    END IF;
    IF cabecera IS NULL THEN
      INSERT INTO public.auditoria (entidad, entidad_id, admin_id, motivo)
        VALUES (TG_TABLE_NAME::public.entidad_auditoria, NEW.id, quien, motivo_tx)
        RETURNING id INTO cabecera;
    END IF;
    INSERT INTO public.auditoria_campo (auditoria_id, posicion, campo, antes, despues)
      VALUES (cabecera, i + 1, campo_tx, antes, despues);
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Solo se ejecuta como trigger: nadie (ni PUBLIC ni kazero_app) la invoca directamente. El dueño la conserva.
REVOKE ALL ON FUNCTION public.kz_auditar() FROM PUBLIC;
--> statement-breakpoint
-- `UPDATE OF`: los envíos, regresos y cambios de estado (estado, exhibidor_id, version) ni disparan el trigger.
CREATE TRIGGER pieza_auditoria AFTER UPDATE OF descripcion, categoria_id, material_id, proveedor_id, costo, precio ON pieza
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('descripcion', 'categoria_id>categoria', 'material_id>material', 'proveedor_id>proveedor', 'costo', 'precio');
--> statement-breakpoint
CREATE TRIGGER vendedor_auditoria AFTER UPDATE OF nombre, tipo, comision_pct, activo ON vendedor
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre', 'tipo', 'comision_pct', 'activo');
--> statement-breakpoint
CREATE TRIGGER cliente_auditoria AFTER UPDATE OF nombre, referencia, telefono, cumpleanos, red_social, usuario_red, vendedor_habitual_id, notas ON cliente
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre', 'referencia', 'telefono', 'cumpleanos', 'red_social', 'usuario_red', 'vendedor_habitual_id>vendedor', 'notas');
--> statement-breakpoint
CREATE TRIGGER exhibidor_auditoria AFTER UPDATE OF nombre, fecha_envio ON exhibidor
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre', 'fecha_envio');
--> statement-breakpoint
CREATE TRIGGER categoria_auditoria AFTER UPDATE OF nombre ON categoria FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre');
--> statement-breakpoint
CREATE TRIGGER material_auditoria AFTER UPDATE OF nombre ON material FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre');
--> statement-breakpoint
CREATE TRIGGER proveedor_auditoria AFTER UPDATE OF nombre ON proveedor FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre');
--> statement-breakpoint
CREATE TRIGGER categoria_updated_at BEFORE UPDATE ON categoria FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
CREATE TRIGGER material_updated_at BEFORE UPDATE ON material FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
CREATE TRIGGER proveedor_updated_at BEFORE UPDATE ON proveedor FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
-- 2. Máquina de estados, versión 3 (parte de 0005): agrega la rama de corrección (R-07).
--    DEBE coincidir con destinoCorreccion de src/domain/correccion.ts: el destino de una corrección es
--    exactamente el que calcula el dominio, nada más.
CREATE OR REPLACE FUNCTION public.kz_validar_transicion_pieza() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ultimo record;
  ex_abierto boolean;
BEGIN
  IF NOT kz_transicion_pieza_permitida(OLD.estado, NEW.estado) THEN
    -- Única excepción: deshacer el último cambio manual a regalo/defecto/guardada. Lo decide el historial
    -- (solo inserción y coherente con la pieza, ver kz_validar_movimiento_pieza), no una bandera de sesión.
    -- Solo llegan aquí regalo→disponible y {regalo,defecto,guardada}→en_exhibidor: defecto→disponible y
    -- guardada→disponible ya son cambios manuales normales.
    IF OLD.estado::text IN ('regalo', 'defecto', 'guardada') AND NEW.estado::text IN ('disponible', 'en_exhibidor') THEN
      SELECT mp.tipo::text AS tipo, mp.de_estado::text AS de, mp.a_estado::text AS a, mp.exhibidor_id
        INTO ultimo
        FROM public.movimiento_pieza mp
        WHERE mp.pieza_id = OLD.id
        ORDER BY mp.orden DESC
        LIMIT 1;
      IF FOUND AND ultimo.tipo = 'cambio_estado' AND ultimo.a = OLD.estado::text THEN
        IF ultimo.de = 'disponible' THEN
          -- Venía de disponible: solo vuelve a disponible.
          IF NEW.estado::text = 'disponible' THEN
            RETURN NEW;
          END IF;
        ELSIF ultimo.de = 'en_exhibidor' AND ultimo.exhibidor_id IS NOT NULL THEN
          -- FOR SHARE: el exhibidor no se cierra mientras esta corrección decide. El servicio ya lo bloqueó
          -- antes que a la pieza (orden exhibidor → pieza), así que aquí no se espera.
          SELECT e.estado::text = 'abierto' INTO ex_abierto
            FROM public.exhibidor e
            WHERE e.id = ultimo.exhibidor_id
            FOR SHARE;
          -- Abierto: vuelve a ESE exhibidor. Cerrado: queda disponible (la app avisa).
          IF ex_abierto AND NEW.estado::text = 'en_exhibidor' AND NEW.exhibidor_id = ultimo.exhibidor_id THEN
            RETURN NEW;
          END IF;
          IF NOT ex_abierto AND NEW.estado::text = 'disponible' THEN
            RETURN NEW;
          END IF;
        END IF;
      END IF;
    END IF;
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
-- 2b. Historial coherente con la pieza. Sin esto la app podría insertar un `cambio_estado` inventado
--     (p. ej. "venía del exhibidor X") y luego "deshacerlo" con la rama de corrección de arriba.
--     Reglas (los servicios ya cambian la pieza ANTES de insertar su movimiento, en la misma transacción):
--     - a_estado = estado actual de la pieza;
--     - alta: solo como primer movimiento y sin de_estado;
--     - resto: de_estado = a_estado del movimiento anterior de esa pieza;
--     - a_estado en_exhibidor: exhibidor_id = el de la pieza; de_estado en_exhibidor: el del movimiento anterior.
--     Los INSERT de varias filas (altaLote, enviar, regresar) traen una fila por pieza distinta; aun si se
--     repitiera una pieza, un trigger BEFORE ROW ve las filas que la misma sentencia ya insertó.
CREATE OR REPLACE FUNCTION public.kz_validar_movimiento_pieza() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  estado_actual text;
  exhibidor_actual uuid;
  hay_previo boolean;
  previo_a text;
  previo_exhibidor uuid;
BEGIN
  -- FOR NO KEY UPDATE: serializa los movimientos de una pieza sin chocar con el FOR KEY SHARE que toman las
  -- FK que apuntan a pieza (p. ej. las líneas de pedido del Plan 3).
  -- Los servicios DEBEN bloquear la pieza (FOR UPDATE, o con el UPDATE de la pieza) ANTES de insertar su
  -- movimiento: `orden` sale de nextval al armar la fila, antes de este trigger, así que dos inserciones sin
  -- ese bloqueo previo podrían quedar con `orden` invertido respecto al orden real en que se validaron.
  SELECT p.estado::text, p.exhibidor_id INTO estado_actual, exhibidor_actual
    FROM public.pieza p WHERE p.id = NEW.pieza_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- La FK rechaza la fila.
  END IF;
  SELECT mp.a_estado::text, mp.exhibidor_id INTO previo_a, previo_exhibidor
    FROM public.movimiento_pieza mp
    WHERE mp.pieza_id = NEW.pieza_id
    ORDER BY mp.orden DESC
    LIMIT 1;
  hay_previo := FOUND;
  IF NEW.a_estado::text <> estado_actual
     OR (NEW.tipo::text = 'alta' AND (hay_previo OR NEW.de_estado IS NOT NULL))
     OR (NEW.tipo::text <> 'alta' AND NEW.de_estado::text IS DISTINCT FROM previo_a)
     OR (NEW.a_estado::text = 'en_exhibidor' AND NEW.exhibidor_id IS DISTINCT FROM exhibidor_actual)
     OR (NEW.de_estado::text = 'en_exhibidor' AND NEW.exhibidor_id IS DISTINCT FROM previo_exhibidor) THEN
    RAISE EXCEPTION 'Movimiento incoherente con la pieza o su historial'
      USING ERRCODE = 'P0001', CONSTRAINT = 'movimiento_coherente';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER movimiento_pieza_coherente BEFORE INSERT ON movimiento_pieza
  FOR EACH ROW EXECUTE FUNCTION kz_validar_movimiento_pieza();
--> statement-breakpoint
-- 3. Vistas. CREATE OR REPLACE solo puede agregar columnas al final (no cambia las existentes).
CREATE VIEW v_auditoria WITH (security_invoker = true) AS
  SELECT a.id AS auditoria_id, a.orden, a.entidad, a.entidad_id, a.motivo, a.created_at AS fecha,
         ad.email AS admin_email, c.posicion, c.campo, c.antes, c.despues
  FROM auditoria a
  JOIN auditoria_campo c ON c.auditoria_id = a.id
  JOIN admin ad ON ad.id = a.admin_id;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_movimiento_pieza WITH (security_invoker = true) AS
  SELECT mp.id, mp.orden, mp.pieza_id, mp.tipo, mp.de_estado, mp.a_estado, mp.nota, mp.fecha,
         mp.exhibidor_id, e.nombre AS exhibidor_nombre,
         mp.admin_id, ad.email AS admin_email, e.estado AS exhibidor_estado
  FROM movimiento_pieza mp
  LEFT JOIN exhibidor e ON e.id = mp.exhibidor_id
  LEFT JOIN admin ad ON ad.id = mp.admin_id;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_catalogo WITH (security_invoker = true) AS
  SELECT 'categoria'::text AS tipo, id, nombre, version FROM categoria
  UNION ALL SELECT 'material'::text, id, nombre, version FROM material
  UNION ALL SELECT 'proveedor'::text, id, nombre, version FROM proveedor;
--> statement-breakpoint
-- 4. Privilegios. La bitácora es de solo lectura para la app (la escribe kz_auditar).
GRANT SELECT ON auditoria, auditoria_campo, v_auditoria TO kazero_app;
--> statement-breakpoint
-- El código de pieza (y su fecha de alta) quedan inmutables para la app: UPDATE por columna.
REVOKE UPDATE ON pieza FROM kazero_app;
--> statement-breakpoint
GRANT UPDATE (categoria_id, material_id, proveedor_id, descripcion, costo, precio, foto_path, estado, exhibidor_id, version, updated_at) ON pieza TO kazero_app;
