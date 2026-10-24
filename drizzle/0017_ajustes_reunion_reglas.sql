-- Plan 3.1: custodia de vendedora (D-8..D-12), devolución de pieza defectuosa (D-13..D-19) y saldo a favor
-- (D-20..D-24). Reglas que no caben en un CHECK.
-- OJO (igual que 0008/0009, 0010/0011 y 0012/0013): 0016 agrega valores con ADD VALUE ('entrega_vendedora',
-- 'regreso_vendedora', 'devolucion' en tipo_movimiento; 'saldo_favor' en metodo_pago; 'devolucion', 'retiro' en
-- tipo_saldo_favor) y el migrador aplica todo en UNA transacción: aquí ninguno se usa como literal del enum
-- (55P04). Siempre `::text = '...'`, que plpgsql resuelve en ejecución.

-- 1. kz_validar_transicion_pieza VERSIÓN 5 = el cuerpo de la v4 (0013) SIN CAMBIOS (rama de corrección R-07 con
--    `ex_abierto` y FOR SHARE del exhibidor; reglas D-11 de exhibidor_id) + dos agregados marcados (v5):
--    (a) vendida → defecto solo por una devolución registrada (D-17);
--    (b) reglas de la custodia de vendedora (D-9).
--    Invoker como siempre: kazero_app lee movimiento_pieza, pedido_item, devolucion y exhibidor.
CREATE OR REPLACE FUNCTION public.kz_validar_transicion_pieza() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ultimo record;
  ex_abierto boolean;
  ultimo_venta record;
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
    -- (v5, D-17) vendida → defecto solo por una devolución: el último movimiento es la venta del pedido P y la
    -- línea de esta pieza en P tiene su devolución registrada. Tras el movimiento 'devolucion' ya no se cumple,
    -- así que no hay una segunda sin una venta nueva. Una pieza vendida no tiene exhibidor ni custodia (CHECK),
    -- y defecto tampoco: no hay más reglas que revisar.
    IF OLD.estado::text = 'vendida' AND NEW.estado::text = 'defecto' THEN
      SELECT mp.tipo::text AS tipo, mp.pedido_id INTO ultimo_venta
        FROM public.movimiento_pieza mp WHERE mp.pieza_id = OLD.id ORDER BY mp.orden DESC LIMIT 1;
      IF FOUND AND ultimo_venta.tipo = 'venta' AND EXISTS (
           SELECT 1 FROM public.devolucion d JOIN public.pedido_item i ON i.id = d.pedido_item_id
           WHERE i.pieza_id = OLD.id AND i.pedido_id = ultimo_venta.pedido_id) THEN
        RETURN NEW;
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
  -- (v5, D-9) Custodia de vendedora: NULL → valor solo al entregar (disponible → disponible); valor → NULL al
  -- regresar, vender o cambiar a mano; nunca de una vendedora a otra, ni ganarla o perderla estando apartada.
  IF OLD.vendedor_custodia_id IS NOT NULL AND NEW.vendedor_custodia_id IS NOT NULL
     AND NEW.vendedor_custodia_id <> OLD.vendedor_custodia_id THEN
    RAISE EXCEPTION 'La pieza debe regresar a Kazero antes de entregarse a otra vendedora'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_cambio_custodia';
  END IF;
  IF OLD.vendedor_custodia_id IS NULL AND NEW.vendedor_custodia_id IS NOT NULL
     AND NOT (OLD.estado::text = 'disponible' AND NEW.estado::text = 'disponible') THEN
    RAISE EXCEPTION 'Solo una pieza disponible en Kazero se entrega a una vendedora'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_cambio_custodia';
  END IF;
  IF OLD.vendedor_custodia_id IS NOT NULL AND NEW.vendedor_custodia_id IS NULL AND NEW.estado::text = 'apartada' THEN
    RAISE EXCEPTION 'Una pieza apartada conserva su vendedora'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_cambio_custodia';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- El trigger también vigila la custodia. DROP + CREATE dentro de la misma transacción del migrador: no hay
-- ventana sin trigger (mismo patrón que 0005).
DROP TRIGGER pieza_transicion ON pieza;
--> statement-breakpoint
CREATE TRIGGER pieza_transicion BEFORE UPDATE OF estado, exhibidor_id, vendedor_custodia_id ON pieza
  FOR EACH ROW EXECUTE FUNCTION kz_validar_transicion_pieza();
--> statement-breakpoint
-- 1b. (D-9) Una pieza nueva nace en Kazero: la custodia solo se gana con una entrega (UPDATE + su movimiento
--     entrega_vendedora), así el historial explica siempre quién la tiene.
CREATE OR REPLACE FUNCTION public.kz_pieza_alta_sin_custodia() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.vendedor_custodia_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una pieza nueva queda en Kazero'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pieza_alta_custodia';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_pieza_alta_sin_custodia() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pieza_alta_sin_custodia BEFORE INSERT ON pieza
  FOR EACH ROW EXECUTE FUNCTION kz_pieza_alta_sin_custodia();
--> statement-breakpoint
-- 2. kz_validar_movimiento_pieza VERSIÓN 2 = el cuerpo de 0009 SIN CAMBIOS + la custodia actual en el mismo
--    SELECT ... FOR NO KEY UPDATE + tres condiciones (v2) en el IF de incoherencia:
--    - entrega_vendedora: vendedor_id = la custodia que la pieza YA tiene (se actualiza antes), queda disponible;
--    - regreso_vendedora: la pieza ya no tiene custodia, queda disponible, y deshace la entrega vigente (el
--      último movimiento que pudo cambiar la custodia es la entrega a esa vendedora);
--    - alta: sin custodia;
--    - devolucion: con pedido, de vendida a defecto, y con la devolución de la línea de esta pieza en ese pedido registrada.
--    El trigger movimiento_pieza_coherente (0009) llama a la función por nombre: CREATE OR REPLACE conserva su
--    oid, así que no se recrea.
CREATE OR REPLACE FUNCTION public.kz_validar_movimiento_pieza() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  estado_actual text;
  exhibidor_actual uuid;
  custodia_actual uuid;
  hay_previo boolean;
  previo_a text;
  previo_exhibidor uuid;
  ultima_custodia record;
BEGIN
  -- FOR NO KEY UPDATE: serializa los movimientos de una pieza sin chocar con el FOR KEY SHARE que toman las
  -- FK que apuntan a pieza (p. ej. las líneas de pedido del Plan 3).
  -- Los servicios DEBEN bloquear la pieza (FOR UPDATE, o con el UPDATE de la pieza) ANTES de insertar su
  -- movimiento: `orden` sale de nextval al armar la fila, antes de este trigger, así que dos inserciones sin
  -- ese bloqueo previo podrían quedar con `orden` invertido respecto al orden real en que se validaron.
  SELECT p.estado::text, p.exhibidor_id, p.vendedor_custodia_id INTO estado_actual, exhibidor_actual, custodia_actual
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
  -- (v2) Un regreso deshace la entrega VIGENTE: el último movimiento que pudo cambiar la custodia (todos salvo
  -- apartado/liberacion, que la conservan) debe ser la entrega a esa misma vendedora. Así un regreso repetido,
  -- uno sin entrega o uno tras un cambio manual que ya la sacó de la custodia no pasan.
  IF NEW.tipo::text = 'regreso_vendedora' THEN
    SELECT mp.tipo::text AS tipo, mp.vendedor_id INTO ultima_custodia
      FROM public.movimiento_pieza mp
      WHERE mp.pieza_id = NEW.pieza_id AND mp.tipo::text NOT IN ('apartado', 'liberacion')
      ORDER BY mp.orden DESC
      LIMIT 1;
    IF NOT FOUND OR ultima_custodia.tipo <> 'entrega_vendedora'
       OR ultima_custodia.vendedor_id IS DISTINCT FROM NEW.vendedor_id THEN
      RAISE EXCEPTION 'Movimiento incoherente con la pieza o su historial'
        USING ERRCODE = 'P0001', CONSTRAINT = 'movimiento_coherente';
    END IF;
  END IF;
  IF NEW.a_estado::text <> estado_actual
     OR (NEW.tipo::text = 'alta' AND (hay_previo OR NEW.de_estado IS NOT NULL))
     -- (v2) El alta es en Kazero (también lo exige el trigger pieza_alta_sin_custodia).
     OR (NEW.tipo::text = 'alta' AND custodia_actual IS NOT NULL)
     OR (NEW.tipo::text <> 'alta' AND NEW.de_estado::text IS DISTINCT FROM previo_a)
     OR (NEW.a_estado::text = 'en_exhibidor' AND NEW.exhibidor_id IS DISTINCT FROM exhibidor_actual)
     OR (NEW.de_estado::text = 'en_exhibidor' AND NEW.exhibidor_id IS DISTINCT FROM previo_exhibidor)
     -- (v2, D-9)
     OR (NEW.tipo::text = 'entrega_vendedora'
         AND (NEW.vendedor_id IS NULL OR NEW.vendedor_id IS DISTINCT FROM custodia_actual OR NEW.a_estado::text <> 'disponible'))
     OR (NEW.tipo::text = 'regreso_vendedora'
         AND (NEW.vendedor_id IS NULL OR custodia_actual IS NOT NULL OR NEW.a_estado::text <> 'disponible'))
     -- (v2, D-17)
     OR (NEW.tipo::text = 'devolucion'
         AND (NEW.pedido_id IS NULL OR NEW.de_estado::text IS DISTINCT FROM 'vendida'
              OR NEW.a_estado::text <> 'defecto' OR NOT EXISTS (
                SELECT 1 FROM public.devolucion d JOIN public.pedido_item i ON i.id = d.pedido_item_id
                WHERE i.pieza_id = NEW.pieza_id AND i.pedido_id = NEW.pedido_id))) THEN
    RAISE EXCEPTION 'Movimiento incoherente con la pieza o su historial'
      USING ERRCODE = 'P0001', CONSTRAINT = 'movimiento_coherente';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- 3. Devolución válida (D-16, D-18). Invoker: kazero_app lee pedido, pedido_item, pieza y devolucion, y tiene
--    UPDATE por columna en pedido (lo que pide FOR NO KEY UPDATE). Orden de bloqueo (D-19): el servicio ya tomó
--    cliente → pedido → pieza; aquí se vuelve a tomar el pedido (ya es suyo: no espera), lo que serializa las
--    devoluciones del mismo pedido para la suma.
CREATE OR REPLACE FUNCTION public.kz_validar_devolucion() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  it record;
  pe record;
  estado_pieza_tx text;
  ultimo record;
  devuelto numeric(12,2);
BEGIN
  SELECT i.pedido_id, i.pieza_id, i.precio_final, i.vigente INTO it
    FROM public.pedido_item i WHERE i.id = NEW.pedido_item_id;
  IF NOT FOUND THEN
    RETURN NEW; -- La FK rechaza la fila.
  END IF;
  SELECT p.estado::text AS estado, p.total, p.fecha INTO pe
    FROM public.pedido p WHERE p.id = it.pedido_id FOR NO KEY UPDATE;
  IF pe.estado <> 'liquidado' THEN
    RAISE EXCEPTION 'Solo se devuelven piezas de pedidos liquidados'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_pedido_no_liquidado';
  END IF;
  IF NOT it.vigente THEN
    RAISE EXCEPTION 'La línea ya salió del pedido'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_linea_no_vigente';
  END IF;
  SELECT pz.estado::text INTO estado_pieza_tx FROM public.pieza pz WHERE pz.id = it.pieza_id;
  IF estado_pieza_tx <> 'vendida' THEN
    RAISE EXCEPTION 'La pieza no está vendida'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_pieza_no_vendida';
  END IF;
  -- Espejo de la regla v5 de pieza_transicion: la pieza está vendida por ESTE pedido (su último movimiento es
  -- la venta de it.pedido_id), no por otro.
  SELECT mp.tipo::text AS tipo, mp.pedido_id INTO ultimo
    FROM public.movimiento_pieza mp WHERE mp.pieza_id = it.pieza_id ORDER BY mp.orden DESC LIMIT 1;
  IF NOT FOUND OR ultimo.tipo <> 'venta' OR ultimo.pedido_id IS DISTINCT FROM it.pedido_id THEN
    RAISE EXCEPTION 'La pieza no está vendida por este pedido'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_no_es_ultima_venta';
  END IF;
  IF NEW.monto > it.precio_final THEN
    RAISE EXCEPTION 'La devolución supera el precio de la línea'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_excede_linea';
  END IF;
  IF NEW.fecha < pe.fecha THEN
    RAISE EXCEPTION 'La devolución no puede ser anterior al pedido'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_fecha';
  END IF;
  SELECT coalesce(sum(d.monto), 0) INTO devuelto
    FROM public.devolucion d JOIN public.pedido_item i ON i.id = d.pedido_item_id
    WHERE i.pedido_id = it.pedido_id;
  IF devuelto + NEW.monto > pe.total THEN
    RAISE EXCEPTION 'Lo devuelto supera el total del pedido'
      USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_excede_total';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_devolucion() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER devolucion_validar BEFORE INSERT ON devolucion
  FOR EACH ROW EXECUTE FUNCTION kz_validar_devolucion();
--> statement-breakpoint
-- 4. kz_validar_saldo_favor VERSIÓN 2 (sigue invoker; mismo trigger saldo_favor_libro de 0013: CREATE OR
--    REPLACE conserva el oid). Agrega la validación del origen (uso ↔ su aplicación, devolucion ↔ su
--    devolución) y aplica "nunca negativo" a todo lo que resta (uso y retiro, D-22). El candado consultivo y
--    la suma son idénticos a 0013.
--    Un uso/devolución SIN su id de origen no se valida aquí: lo rechaza el CHECK saldo_favor_origen. Un
--    movimiento de otro tipo con monto negativo tampoco: lo rechaza el CHECK saldo_favor_signo_v2 (así sigue
--    reportándose como hasta ahora, en vez de como saldo insuficiente).
CREATE OR REPLACE FUNCTION public.kz_validar_saldo_favor() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  saldo_actual numeric(12,2);
  ap record;
  dv record;
BEGIN
  IF NEW.tipo::text = 'uso' AND NEW.aplicacion_pago_id IS NOT NULL THEN
    SELECT a.monto, a.pedido_id, a.anulada_at, pg.metodo::text AS metodo, pg.pagador_cliente_id, pg.pagador_vendedor_id
      INTO ap
      FROM public.aplicacion_pago a JOIN public.pago pg ON pg.id = a.pago_id
      WHERE a.id = NEW.aplicacion_pago_id;
    IF NOT FOUND THEN
      RETURN NEW; -- La FK rechaza la fila.
    END IF;
    IF ap.metodo <> 'saldo_favor' OR ap.anulada_at IS NOT NULL OR -NEW.monto <> ap.monto
       OR NEW.pedido_id IS DISTINCT FROM ap.pedido_id
       OR NEW.cliente_id IS DISTINCT FROM ap.pagador_cliente_id
       OR NEW.vendedor_id IS DISTINCT FROM ap.pagador_vendedor_id THEN
      RAISE EXCEPTION 'El uso de saldo a favor no coincide con su aplicación'
        USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_uso_incoherente';
    END IF;
  ELSIF NEW.tipo::text = 'devolucion' AND NEW.devolucion_id IS NOT NULL THEN
    SELECT d.monto, i.pedido_id, p.cliente_id INTO dv
      FROM public.devolucion d
      JOIN public.pedido_item i ON i.id = d.pedido_item_id
      JOIN public.pedido p ON p.id = i.pedido_id
      WHERE d.id = NEW.devolucion_id;
    IF NOT FOUND THEN
      RETURN NEW; -- La FK rechaza la fila.
    END IF;
    IF NEW.monto <> dv.monto OR NEW.pedido_id IS DISTINCT FROM dv.pedido_id
       OR NEW.cliente_id IS DISTINCT FROM dv.cliente_id THEN
      RAISE EXCEPTION 'El saldo de la devolución no coincide con la devolución'
        USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_devolucion_incoherente';
    END IF;
  END IF;
  -- D-22: todo lo que resta (uso y retiro) se serializa por titular y nunca deja el saldo negativo.
  IF NEW.tipo::text NOT IN ('uso', 'retiro') OR NEW.monto >= 0 THEN
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
-- 5. El dinero no se pierde: garantía en ambos sentidos con constraint triggers DIFERIDOS (se revisan al
--    confirmar, cuando la transacción ya insertó todo):
--    - una devolución sin su movimiento 'devolucion' en el libro (D-16);
--    - una aplicación de un pago saldo_favor sin su 'uso' (D-20);
--    - un pago saldo_favor cuyo monto no esté aplicado completo (D-20).
--    El otro sentido lo dan los CHECK saldo_favor_origen y los índices únicos de 0016 más el trigger del libro.
--    El error de un diferido sale en el COMMIT: conErroresDeNegocio envuelve db.transaction completo, así que
--    lo traduce igual. Invoker: kazero_app lee saldo_favor_mov, pago y aplicacion_pago. AFTER ROW: RETURN NULL.
CREATE OR REPLACE FUNCTION public.kz_exigir_movimiento_saldo() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'devolucion' THEN
    IF NOT EXISTS (SELECT 1 FROM public.saldo_favor_mov s WHERE s.devolucion_id = NEW.id) THEN
      RAISE EXCEPTION 'Devolución sin su saldo a favor'
        USING ERRCODE = 'P0001', CONSTRAINT = 'devolucion_sin_saldo';
    END IF;
  ELSIF TG_TABLE_NAME = 'aplicacion_pago' THEN
    IF (SELECT pg.metodo::text FROM public.pago pg WHERE pg.id = NEW.pago_id) = 'saldo_favor'
       AND NOT EXISTS (SELECT 1 FROM public.saldo_favor_mov s WHERE s.aplicacion_pago_id = NEW.id) THEN
      RAISE EXCEPTION 'Aplicación con saldo a favor sin su movimiento'
        USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_uso_faltante';
    END IF;
  ELSIF TG_TABLE_NAME = 'pago' THEN
    -- Todo el pago se aplica: lo aplicado vigente es exactamente su monto (un sobrante de saldo no existe).
    IF NEW.metodo::text = 'saldo_favor'
       AND (SELECT coalesce(sum(a.monto), 0) FROM public.aplicacion_pago a
            WHERE a.pago_id = NEW.id AND a.anulada_at IS NULL) <> NEW.monto THEN
      RAISE EXCEPTION 'Pago con saldo a favor sin aplicar completo'
        USING ERRCODE = 'P0001', CONSTRAINT = 'pago_saldo_sin_aplicacion';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Solo se ejecuta como trigger: nadie la invoca directamente.
REVOKE ALL ON FUNCTION public.kz_exigir_movimiento_saldo() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER devolucion_con_saldo AFTER INSERT ON devolucion
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kz_exigir_movimiento_saldo();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aplicacion_saldo_con_uso AFTER INSERT ON aplicacion_pago
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kz_exigir_movimiento_saldo();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pago_saldo_con_aplicacion AFTER INSERT ON pago
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kz_exigir_movimiento_saldo();
--> statement-breakpoint
-- 6. saldo_favor_pedido_requerido (0013) vive solo en SQL; su versión más permisiva _v2 ya existe por 0016
--    (D-22: reemplazar un CHECK por uno estrictamente más amplio es compatible hacia atrás).
ALTER TABLE saldo_favor_mov DROP CONSTRAINT saldo_favor_pedido_requerido;
--> statement-breakpoint
-- 7. Vistas. Columnas nuevas SIEMPRE al final (CREATE OR REPLACE VIEW no deja reordenar ni cambiar tipos) y
--    mismas columnas y orden que su última versión: v_pieza de 0011; v_movimiento_pieza, v_pedido y
--    v_pedido_item de 0013. CREATE OR REPLACE conserva su GRANT SELECT a kazero_app.
CREATE OR REPLACE VIEW v_pieza WITH (security_invoker = true) AS
  SELECT p.id, p.codigo, p.descripcion, p.costo, p.precio, p.fecha_alta, p.estado, p.version,
         p.categoria_id, cat.nombre AS categoria_nombre,
         p.material_id, m.nombre AS material_nombre,
         p.proveedor_id, pr.nombre AS proveedor_nombre,
         p.exhibidor_id, e.nombre AS exhibidor_nombre,
         p.imagen_clave,
         p.vendedor_custodia_id, vc.nombre AS vendedor_custodia_nombre,
         -- D-8: ubicación derivada (DEBE coincidir con src/domain/ubicacion.ts).
         (CASE WHEN p.exhibidor_id IS NOT NULL THEN 'exhibidor'
               WHEN p.vendedor_custodia_id IS NOT NULL THEN 'vendedora'
               WHEN p.estado::text IN ('vendida', 'regalo') THEN 'fuera'
               ELSE 'kazero' END) AS ubicacion
  FROM pieza p
  JOIN categoria cat ON cat.id = p.categoria_id
  LEFT JOIN material m ON m.id = p.material_id
  LEFT JOIN proveedor pr ON pr.id = p.proveedor_id
  LEFT JOIN exhibidor e ON e.id = p.exhibidor_id
  LEFT JOIN vendedor vc ON vc.id = p.vendedor_custodia_id;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_movimiento_pieza WITH (security_invoker = true) AS
  SELECT mp.id, mp.orden, mp.pieza_id, mp.tipo, mp.de_estado, mp.a_estado, mp.nota, mp.fecha,
         mp.exhibidor_id, e.nombre AS exhibidor_nombre,
         mp.admin_id, ad.email AS admin_email, e.estado AS exhibidor_estado,
         mp.pedido_id, p.folio AS pedido_folio,
         mp.vendedor_id, vm.nombre AS vendedor_nombre
  FROM movimiento_pieza mp
  LEFT JOIN exhibidor e ON e.id = mp.exhibidor_id
  LEFT JOIN admin ad ON ad.id = mp.admin_id
  LEFT JOIN pedido p ON p.id = mp.pedido_id
  LEFT JOIN vendedor vm ON vm.id = mp.vendedor_id;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_pedido WITH (security_invoker = true) AS
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
         p.notas, p.created_at, p.liquidado_at, p.cancelado_at, p.cancelacion_motivo,
         -- D-14/D-16: lo devuelto a saldo a favor (el pedido conserva total y pagos).
         coalesce(dv.devuelto, 0)::numeric(12,2) AS devuelto
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
  ) ap ON true
  LEFT JOIN LATERAL (
    SELECT sum(d.monto) AS devuelto
    FROM devolucion d JOIN pedido_item i2 ON i2.id = d.pedido_item_id
    WHERE i2.pedido_id = p.id
  ) dv ON true;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_pedido_item WITH (security_invoker = true) AS
  SELECT i.id, i.pedido_id, p.folio, p.estado AS pedido_estado, p.cliente_id, c.nombre AS cliente_nombre,
         i.pieza_id, pz.codigo, pz.descripcion, pz.estado AS pieza_estado, pz.exhibidor_id,
         i.precio_lista, i.precio_final, i.vigente, i.quitado_at,
         d.id AS devolucion_id, d.fecha AS devolucion_fecha, d.motivo AS devolucion_motivo, d.monto AS devolucion_monto
  FROM pedido_item i
  JOIN pedido p ON p.id = i.pedido_id
  JOIN cliente c ON c.id = p.cliente_id
  JOIN pieza pz ON pz.id = i.pieza_id
  LEFT JOIN devolucion d ON d.pedido_item_id = i.id;
--> statement-breakpoint
-- Historial del saldo a favor (ficha del cliente, D-23): una fila por movimiento con su origen.
CREATE VIEW v_saldo_favor_mov WITH (security_invoker = true) AS
  SELECT s.id, s.cliente_id, s.vendedor_id, s.tipo, s.monto, s.fecha, s.pedido_id, p.folio AS pedido_folio,
         s.aplicacion_pago_id, s.devolucion_id, d.motivo AS devolucion_motivo, s.nota,
         s.admin_id, ad.email AS admin_email, s.created_at
  FROM saldo_favor_mov s
  LEFT JOIN pedido p ON p.id = s.pedido_id
  LEFT JOIN devolucion d ON d.id = s.devolucion_id
  LEFT JOIN admin ad ON ad.id = s.admin_id;
--> statement-breakpoint
-- 8. Privilegios. La devolución no se edita ni se borra (como el libro de pagos).
GRANT UPDATE (vendedor_custodia_id) ON pieza TO kazero_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON devolucion TO kazero_app;
--> statement-breakpoint
GRANT SELECT ON v_saldo_favor_mov TO kazero_app;
