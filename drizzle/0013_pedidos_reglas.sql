-- Plan 3: pedidos, pagos y saldo a favor. Reglas que no caben en un CHECK.
-- OJO (igual que 0008/0009 y 0010/0011): 0012 agrega valores con ADD VALUE ('apartado', 'liberacion' en
-- tipo_movimiento; 'pedido' en entidad_auditoria) y el migrador aplica todo en UNA transacción: aquí ninguno se
-- usa como literal del enum (55P04). Solo los resuelve plpgsql en ejecución o la app. Los enums NUEVOS de 0012
-- (estado_pedido, ...) sí pueden usarse: se crearon, no se ampliaron.

-- 1. kz_validar_transicion_pieza VERSIÓN 4 = el cuerpo de la v3 (0009) SIN CAMBIOS (rama de corrección R-07 con
--    `ex_abierto` y FOR SHARE del exhibidor) + D-11. Solo cambia el bloque final: la regla v3 "en_exhibidor ->
--    en_exhibidor con otro exhibidor" se sustituye por dos reglas sobre exhibidor_id: solo pasa de NULL a un valor
--    (entrando a en_exhibidor) o de un valor a NULL; nunca de un exhibidor a otro, tampoco vía apartada. Así el
--    exhibidor de una pieza apartada es estable y cancelar un pedido sabe a dónde regresa la pieza.
--    El trigger pieza_transicion (BEFORE UPDATE OF estado, exhibidor_id, 0005) llama a la función por nombre:
--    CREATE OR REPLACE conserva su oid, así que no se recrea.
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
  -- (v4, D-11) Sustituye la regla v3 "en_exhibidor -> en_exhibidor con otro exhibidor", que dejaba el hueco
  -- vía apartada: nunca de un exhibidor a otro, en ningún estado.
  IF OLD.exhibidor_id IS NOT NULL AND NEW.exhibidor_id IS NOT NULL AND NEW.exhibidor_id <> OLD.exhibidor_id THEN
    RAISE EXCEPTION 'La pieza debe regresar antes de cambiar de exhibidor'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_cambio_exhibidor';
  END IF;
  -- Solo una pieza que entra a un exhibidor gana exhibidor. Se nombra 'apartada' (el único otro estado que
  -- puede tener exhibidor): en los demás, el CHECK pieza_exhibidor_solo_si_aplica ya rechaza con su propio
  -- mensaje, que la prueba del Plan 2 conserva.
  IF OLD.exhibidor_id IS NULL AND NEW.exhibidor_id IS NOT NULL AND NEW.estado::text = 'apartada' THEN
    RAISE EXCEPTION 'Solo una pieza que entra a un exhibidor puede ganar exhibidor'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_cambio_exhibidor';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- 2. Bitácora de pedido. kz_auditar guarda su lista de dinero DENTRO del cuerpo, así que se redefine COMPLETA:
--    cuerpo de 0009 idéntico salvo la lista de dinero, que gana 'total' y 'descuento_manual_monto' (DEBE
--    coincidir con CAMPOS_DINERO de src/domain/auditoria.ts). Cabecera EXACTA de 0009: SECURITY DEFINER y
--    search_path fijo con pg_catalog primero. Los triggers existentes (pieza con imagen_clave de 0011, vendedor,
--    cliente, exhibidor, catálogos) NO se tocan: CREATE OR REPLACE conserva el oid, el dueño y el ACL.
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
    IF campo_tx IN ('costo', 'precio', 'comision_pct', 'total', 'descuento_manual_monto') AND motivo_tx IS NULL THEN
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
-- CREATE OR REPLACE conserva dueño y ACL; se reafirma por si acaso. Nadie la invoca directamente.
REVOKE ALL ON FUNCTION public.kz_auditar() FROM PUBLIC;
--> statement-breakpoint
-- OJO servicios: CUALQUIER cambio de `total` (también un recálculo automático al editar líneas) y de
-- `descuento_manual_monto` exige motivo en el contexto (fijarContextoAuditoria); sin él falla con
-- auditoria_motivo_dinero. Crear el pedido no lo exige (es INSERT, no UPDATE).
-- `UPDATE OF`: version, updated_at, liquidado_at y cancelado_at no disparan la bitácora (estado ya lo cuenta).
-- Las columnas de lealtad, folio, cliente y admin no se auditan: kazero_app no puede cambiarlas (R-27).
CREATE TRIGGER pedido_auditoria AFTER UPDATE OF vendedor_id, fecha, estado, descuento_manual_monto, descuento_manual_motivo, total, notas, cancelacion_motivo ON pedido
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('vendedor_id>vendedor', 'fecha', 'estado', 'descuento_manual_monto', 'descuento_manual_motivo', 'total', 'notas', 'cancelacion_motivo');
--> statement-breakpoint
-- 3. Máquina de estados de pedido (spec §5). R-18: liquidado → cancelado NO está permitido; cancelado es final.
CREATE OR REPLACE FUNCTION public.kz_validar_transicion_pedido() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.estado <> NEW.estado AND (OLD.estado::text || '>' || NEW.estado::text) <> ALL (ARRAY[
    'abierto>liquidado', 'liquidado>abierto', 'abierto>cancelado'
  ]) THEN
    RAISE EXCEPTION 'Transición de pedido no permitida: % → %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001', CONSTRAINT = 'pedido_transicion';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pedido_transicion BEFORE UPDATE OF estado ON pedido
  FOR EACH ROW EXECUTE FUNCTION kz_validar_transicion_pedido();
--> statement-breakpoint
CREATE TRIGGER pedido_updated_at BEFORE UPDATE ON pedido FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
CREATE TRIGGER pedido_item_updated_at BEFORE UPDATE ON pedido_item FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();
--> statement-breakpoint
-- 4. Privilegios: sin DELETE en ninguna tabla de dinero o historial (spec §7.1).
--    R-27 en la BD: folio, cliente, admin y todas las columnas de lealtad NO son actualizables por la app.
--    folio es identity: el INSERT usa su secuencia interna sin privilegio aparte sobre pedido_folio_seq.
GRANT SELECT, INSERT ON pedido TO kazero_app;
--> statement-breakpoint
GRANT UPDATE (vendedor_id, fecha, estado, descuento_manual_monto, descuento_manual_motivo, total, notas,
  liquidado_at, cancelado_at, cancelacion_motivo, version, updated_at) ON pedido TO kazero_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON pedido_item TO kazero_app;
--> statement-breakpoint
-- R-11: precio_lista y precio_final no cambian después de insertarse.
GRANT UPDATE (vigente, quitado_at, updated_at) ON pedido_item TO kazero_app;
--> statement-breakpoint
-- Los pagos no se editan ni se borran; el saldo a favor es un libro de solo inserción.
GRANT SELECT, INSERT ON pago, saldo_favor_mov TO kazero_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON aplicacion_pago TO kazero_app;
--> statement-breakpoint
-- Las reversiones anulan, no borran: única columna actualizable.
GRANT UPDATE (anulada_at) ON aplicacion_pago TO kazero_app;
--> statement-breakpoint
-- 5. Vistas de lectura (security_invoker, columnas explícitas, agregados sin N+1).
CREATE VIEW v_pedido WITH (security_invoker = true) AS
  SELECT p.id, p.folio, p.fecha, p.estado, p.version,
         p.cliente_id, c.nombre AS cliente_nombre, p.vendedor_id, v.nombre AS vendedor_nombre,
         p.cuenta_tarjeta, p.ciclo_tarjeta, p.posicion_tarjeta, p.descuento_lealtad_pct, p.sin_lealtad_motivo,
         p.descuento_manual_monto, p.descuento_manual_motivo,
         coalesce(it.subtotal, 0)::numeric(12,2) AS subtotal,
         coalesce(it.descuento_lealtad, 0)::numeric(12,2) AS descuento_lealtad_monto,
         p.total,
         coalesce(ap.pagado, 0)::numeric(12,2) AS pagado,
         (CASE WHEN p.estado = 'cancelado' THEN 0 ELSE p.total - coalesce(ap.pagado, 0) END)::numeric(12,2) AS saldo,
         coalesce(it.piezas, 0)::int AS piezas,
         p.notas, p.created_at, p.liquidado_at, p.cancelado_at, p.cancelacion_motivo
  FROM pedido p
  JOIN cliente c ON c.id = p.cliente_id
  JOIN vendedor v ON v.id = p.vendedor_id
  -- LATERAL: con un filtro por pedido usa los índices por pedido_id en vez de agregar toda la tabla.
  LEFT JOIN LATERAL (
    SELECT sum(i.precio_lista) AS subtotal, sum(i.precio_lista - i.precio_final) AS descuento_lealtad, count(*) AS piezas
    FROM pedido_item i WHERE i.pedido_id = p.id AND i.quitado_at IS NULL
  ) it ON true
  LEFT JOIN LATERAL (
    SELECT sum(a.monto) AS pagado FROM aplicacion_pago a WHERE a.pedido_id = p.id AND a.anulada_at IS NULL
  ) ap ON true;
--> statement-breakpoint
CREATE VIEW v_pedido_item WITH (security_invoker = true) AS
  SELECT i.id, i.pedido_id, p.folio, p.estado AS pedido_estado, p.cliente_id, c.nombre AS cliente_nombre,
         i.pieza_id, pz.codigo, pz.descripcion, pz.estado AS pieza_estado, pz.exhibidor_id,
         i.precio_lista, i.precio_final, i.vigente, i.quitado_at
  FROM pedido_item i
  JOIN pedido p ON p.id = i.pedido_id
  JOIN cliente c ON c.id = p.cliente_id
  JOIN pieza pz ON pz.id = i.pieza_id;
--> statement-breakpoint
CREATE VIEW v_aplicacion_pago WITH (security_invoker = true) AS
  SELECT a.id, a.pedido_id, a.pago_id, a.monto, a.fecha, a.anulada_at, pg.metodo, pg.nota,
         (CASE WHEN pg.pagador_cliente_id IS NOT NULL THEN 'cliente' ELSE 'vendedor' END) AS pagador_tipo,
         coalesce(c.nombre, v.nombre) AS pagador_nombre, a.created_at
  FROM aplicacion_pago a
  JOIN pago pg ON pg.id = a.pago_id
  LEFT JOIN cliente c ON c.id = pg.pagador_cliente_id
  LEFT JOIN vendedor v ON v.id = pg.pagador_vendedor_id;
--> statement-breakpoint
CREATE VIEW v_saldo_favor WITH (security_invoker = true) AS
  SELECT cliente_id, vendedor_id, sum(monto)::numeric(12,2) AS saldo
  FROM saldo_favor_mov
  GROUP BY cliente_id, vendedor_id;
--> statement-breakpoint
-- Columnas nuevas SIEMPRE al final (CREATE OR REPLACE VIEW no deja reordenar ni cambiar tipos).
-- v_exhibidor parte de 0003 (sin cambios desde entonces); v_movimiento_pieza de 0009 (Plan 2.1).
-- CREATE OR REPLACE conserva su GRANT SELECT a kazero_app.
CREATE OR REPLACE VIEW v_exhibidor WITH (security_invoker = true) AS
  SELECT e.id, e.nombre, e.fecha_envio, e.estado, e.version, e.vendedor_id, v.nombre AS vendedor_nombre,
         coalesce(pz.n, 0)::int AS piezas_actuales,
         coalesce(pz.apartadas, 0)::int AS piezas_apartadas
  FROM exhibidor e
  JOIN vendedor v ON v.id = e.vendedor_id
  LEFT JOIN (
    SELECT exhibidor_id,
           count(*) FILTER (WHERE estado = 'en_exhibidor') AS n,
           count(*) FILTER (WHERE estado = 'apartada') AS apartadas
    FROM pieza WHERE exhibidor_id IS NOT NULL GROUP BY exhibidor_id
  ) pz ON pz.exhibidor_id = e.id;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_movimiento_pieza WITH (security_invoker = true) AS
  SELECT mp.id, mp.orden, mp.pieza_id, mp.tipo, mp.de_estado, mp.a_estado, mp.nota, mp.fecha,
         mp.exhibidor_id, e.nombre AS exhibidor_nombre,
         mp.admin_id, ad.email AS admin_email, e.estado AS exhibidor_estado,
         mp.pedido_id, p.folio AS pedido_folio
  FROM movimiento_pieza mp
  LEFT JOIN exhibidor e ON e.id = mp.exhibidor_id
  LEFT JOIN admin ad ON ad.id = mp.admin_id
  LEFT JOIN pedido p ON p.id = mp.pedido_id;
--> statement-breakpoint
GRANT SELECT ON v_pedido, v_pedido_item, v_aplicacion_pago, v_saldo_favor TO kazero_app;
--> statement-breakpoint
-- 6. Columnas de solo avance. Los privilegios por columna dejan a la app escribirlas, pero nunca hacia atrás:
--    - aplicacion_pago.anulada_at: NULL → valor, una sola vez (una anulación no se deshace ni se re-fecha);
--    - pedido_item.vigente: true → false (una línea cancelada o quitada no revive: R-05 depende de ello);
--    - pedido_item.quitado_at: NULL → valor, una sola vez y solo al salir del pedido (OLD.vigente); el CHECK
--      pedido_item_quitado_coherente exige además NOT vigente.
CREATE OR REPLACE FUNCTION public.kz_aplicacion_pago_solo_avance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.anulada_at IS NOT NULL AND NEW.anulada_at IS DISTINCT FROM OLD.anulada_at THEN
    RAISE EXCEPTION 'Una aplicación anulada no puede cambiar'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_anulada_final';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aplicacion_pago_solo_avance BEFORE UPDATE ON aplicacion_pago
  FOR EACH ROW EXECUTE FUNCTION kz_aplicacion_pago_solo_avance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.kz_pedido_item_solo_avance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT OLD.vigente AND NEW.vigente THEN
    RAISE EXCEPTION 'Una línea que salió del pedido no vuelve'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pedido_item_vigente_final';
  END IF;
  IF (OLD.quitado_at IS NOT NULL AND NEW.quitado_at IS DISTINCT FROM OLD.quitado_at)
     OR (OLD.quitado_at IS NULL AND NEW.quitado_at IS NOT NULL AND NOT OLD.vigente) THEN
    RAISE EXCEPTION 'La fecha en que se quitó la línea no cambia'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pedido_item_quitado_final';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pedido_item_solo_avance BEFORE UPDATE ON pedido_item
  FOR EACH ROW EXECUTE FUNCTION kz_pedido_item_solo_avance();
--> statement-breakpoint
-- 7. Libro de pagos garantizado por la BD (spec §7.1): lo aplicado vigente de un pago nunca supera su monto y
--    no se aplica a un pedido cancelado.
--    ORDEN DE BLOQUEO (sin interbloqueos): cliente → pedido(s) por id → [exhibidores → piezas] → pago. Los
--    servicios bloquean cliente y pedido ANTES de insertar/anular aplicaciones; este trigger vuelve a tomar el
--    pedido (ya es suyo: no espera) y DESPUÉS el pago (recién insertado por la misma transacción, o el de otra
--    aplicación al anular). Ningún servicio debe bloquear un pago antes que sus pedidos.
--    SECURITY DEFINER: FOR NO KEY UPDATE exige privilegio UPDATE y kazero_app no tiene ninguno sobre `pago`
--    (los pagos no se editan). search_path fijo y nombres calificados, como kz_auditar; sin EXECUTE para nadie.
--    En READ COMMITTED cada sentencia de plpgsql toma instantánea nueva: la suma posterior al bloqueo ve lo que
--    confirmó la transacción que lo tenía.
CREATE OR REPLACE FUNCTION public.kz_validar_aplicacion_pago() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  estado_pedido_tx text;
  monto_pago numeric(12,2);
  aplicado numeric(12,2);
BEGIN
  -- Anular (o una aplicación que nace anulada) solo resta: no hay nada que validar ni bloquear.
  IF NEW.anulada_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.estado::text INTO estado_pedido_tx FROM public.pedido p WHERE p.id = NEW.pedido_id FOR NO KEY UPDATE;
  IF estado_pedido_tx = 'cancelado' THEN
    RAISE EXCEPTION 'No se aplican pagos a un pedido cancelado'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_pedido_cancelado';
  END IF;
  SELECT pg.monto INTO monto_pago FROM public.pago pg WHERE pg.id = NEW.pago_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- La FK rechaza la fila.
  END IF;
  SELECT coalesce(sum(a.monto), 0) INTO aplicado
    FROM public.aplicacion_pago a
    WHERE a.pago_id = NEW.pago_id AND a.anulada_at IS NULL AND a.id <> NEW.id;
  IF aplicado + NEW.monto > monto_pago THEN
    RAISE EXCEPTION 'Lo aplicado supera el monto del pago'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_excede_pago';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_aplicacion_pago() FROM PUBLIC;
--> statement-breakpoint
-- Los BEFORE corren por orden de nombre: aplicacion_pago_solo_avance antes que aplicacion_pago_validar_libro,
-- así una reactivación se rechaza como tal y no como exceso.
CREATE TRIGGER aplicacion_pago_validar_libro BEFORE INSERT OR UPDATE ON aplicacion_pago
  FOR EACH ROW EXECUTE FUNCTION kz_validar_aplicacion_pago();
--> statement-breakpoint
-- 8. Saldo a favor: un libro por titular que nunca queda negativo. Se serializa por titular con un candado
--    consultivo de transacción (no bloquea filas de cliente/vendedor, así que no altera el orden de bloqueo
--    cliente → pedido → ...; los servicios lo toman al final, al insertar el movimiento). Invoker: kazero_app
--    ya puede leer saldo_favor_mov y los candados consultivos no piden privilegios.
CREATE OR REPLACE FUNCTION public.kz_validar_saldo_favor() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  saldo_actual numeric(12,2);
BEGIN
  -- Solo un uso resta. Las entradas con signo equivocado las rechaza el CHECK saldo_favor_signo.
  IF NEW.tipo::text <> 'uso' OR NEW.monto >= 0 THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'saldo_favor:' || CASE WHEN NEW.cliente_id IS NOT NULL THEN 'c:' || NEW.cliente_id::text
                           ELSE 'v:' || NEW.vendedor_id::text END, 0));
  SELECT coalesce(sum(s.monto), 0) INTO saldo_actual
    FROM public.saldo_favor_mov s
    WHERE (NEW.cliente_id IS NOT NULL AND s.cliente_id = NEW.cliente_id)
       OR (NEW.vendedor_id IS NOT NULL AND s.vendedor_id = NEW.vendedor_id);
  IF saldo_actual + NEW.monto < 0 THEN
    RAISE EXCEPTION 'El saldo a favor no alcanza'
      USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_insuficiente';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER saldo_favor_libro BEFORE INSERT ON saldo_favor_mov
  FOR EACH ROW EXECUTE FUNCTION kz_validar_saldo_favor();
--> statement-breakpoint
-- cancelacion y uso siempre nacen de un pedido; sobrante (Plan 4) puede no tenerlo. Va aquí y no en el
-- esquema TS (como los índices de kz_normalizar de 0003): tipo_saldo_favor es un enum nuevo de 0012, así que
-- su literal sí puede usarse en esta tanda.
ALTER TABLE saldo_favor_mov ADD CONSTRAINT saldo_favor_pedido_requerido
  CHECK (tipo = 'sobrante' OR pedido_id IS NOT NULL);
