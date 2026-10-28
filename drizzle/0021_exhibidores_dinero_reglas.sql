-- Plan 4a: clienta de mostrador (E-3), cobro por exhibidor (E-4), por entregar (E-5), entregas y ajustes (E-6) y
-- cierre sin dinero (E-8). Reglas que no caben en un CHECK. Los enums nacen con CREATE TYPE en 0020, pero igual
-- que en 0019 se comparan como `::text`.

-- 1. (E-3) La única clienta «Venta de mostrador» (índice único parcial cliente_mostrador_uq). Idempotente; quien
--    vacía `cliente` (pruebas, limpieza) la resiembra con la misma sentencia (scripts/lib/limpieza.ts).
INSERT INTO cliente (nombre, es_mostrador, notas)
  SELECT 'Venta de mostrador', true, 'Clienta genérica para ventas de exhibidor sin clienta conocida.'
  WHERE NOT EXISTS (SELECT 1 FROM cliente WHERE es_mostrador);
--> statement-breakpoint
-- 2. (E-5) Por entregar = Σ pagos cobrados por el exhibidor − Σ entregas + Σ ajustes (con signo). Lo cobrado no
--    se des-cobra (E-7): cuenta el pago, no sus aplicaciones. Invoker: kazero_app lee pago y entrega_exhibidor.
CREATE OR REPLACE FUNCTION public.kz_por_entregar(p_exhibidor uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
  AS $$
  SELECT (SELECT coalesce(sum(pg.monto), 0) FROM pago pg WHERE pg.exhibidor_id = p_exhibidor)
       + (SELECT coalesce(sum(CASE WHEN e.tipo::text = 'entrega' THEN -e.monto ELSE e.monto END), 0)
            FROM entrega_exhibidor e WHERE e.exhibidor_id = p_exhibidor)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_por_entregar(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kz_por_entregar(uuid) TO kazero_app;
--> statement-breakpoint
-- 3. (E-3) Las notas de la clienta de mostrador no cuentan en tarjeta (ni llevan, por tanto, descuento de
--    lealtad: lo exige pedido_tarjeta_coherente).
CREATE OR REPLACE FUNCTION public.kz_pedido_mostrador_sin_tarjeta() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.cuenta_tarjeta AND EXISTS (SELECT 1 FROM public.cliente c WHERE c.id = NEW.cliente_id AND c.es_mostrador) THEN
    RAISE EXCEPTION 'Las notas de venta de mostrador no cuentan en tarjeta'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pedido_mostrador_sin_tarjeta';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_pedido_mostrador_sin_tarjeta() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pedido_mostrador_sin_tarjeta BEFORE INSERT OR UPDATE OF cliente_id, cuenta_tarjeta ON pedido
  FOR EACH ROW EXECUTE FUNCTION kz_pedido_mostrador_sin_tarjeta();
--> statement-breakpoint
-- 4. (E-4) Un pago cobrado por un exhibidor solo se aplica a un pedido de su vendedora responsable y con el
--    exhibidor abierto. FOR SHARE del exhibidor: un cierre concurrente espera a este cobro (y su trigger lo ve) o
--    este cobro ve el exhibidor ya cerrado. Orden de bloqueo de 0013: el servicio ya tiene el pedido; el
--    exhibidor va antes que el pago (que es de esta misma transacción). Corre antes que
--    aplicacion_pago_validar_libro (orden por nombre). Invoker: kazero_app puede bloquear exhibidor (tiene UPDATE).
CREATE OR REPLACE FUNCTION public.kz_validar_pago_exhibidor() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ex record;
  vendedor_pedido uuid;
BEGIN
  SELECT e.estado::text AS estado, e.vendedor_id INTO ex
    FROM public.pago pg JOIN public.exhibidor e ON e.id = pg.exhibidor_id
    WHERE pg.id = NEW.pago_id
    FOR SHARE OF e;
  IF NOT FOUND THEN
    RETURN NEW; -- Pago sin exhibidor (o la FK rechaza la fila).
  END IF;
  SELECT p.vendedor_id INTO vendedor_pedido FROM public.pedido p WHERE p.id = NEW.pedido_id;
  IF NOT FOUND THEN
    RETURN NEW; -- La FK rechaza la fila.
  END IF;
  IF ex.estado <> 'abierto' OR vendedor_pedido <> ex.vendedor_id THEN
    RAISE EXCEPTION 'El exhibidor que cobró debe estar abierto y ser de la vendedora del pedido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_exhibidor_coherente';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_pago_exhibidor() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER aplicacion_pago_exhibidor BEFORE INSERT ON aplicacion_pago
  FOR EACH ROW EXECUTE FUNCTION kz_validar_pago_exhibidor();
--> statement-breakpoint
-- 5. (E-6) Una entrega o ajuste: fecha no futura (en México) y, bajo un candado consultivo por exhibidor (el
--    mismo del cierre), el por entregar resultante no queda negativo. Cada sentencia de plpgsql toma instantánea
--    nueva: la suma posterior al candado ve lo que confirmó quien lo tenía.
CREATE OR REPLACE FUNCTION public.kz_validar_entrega_exhibidor() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.fecha > (now() AT TIME ZONE 'America/Mexico_City')::date THEN
    RAISE EXCEPTION 'La fecha de la entrega no puede ser futura'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entrega_exhibidor_fecha';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kz_exhibidor_dinero:' || NEW.exhibidor_id));
  -- Cerrado implica por entregar = 0 (E-8): ni entregas ni ajustes sobre un exhibidor cerrado. El cierre toma este
  -- mismo candado, así que no hay carrera con la lectura.
  IF EXISTS (SELECT 1 FROM public.exhibidor e WHERE e.id = NEW.exhibidor_id AND e.estado::text = 'cerrado') THEN
    RAISE EXCEPTION 'El exhibidor está cerrado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entrega_exhibidor_cerrado';
  END IF;
  IF public.kz_por_entregar(NEW.exhibidor_id)
     -- Paréntesis obligatorios: el IF de plpgsql corta la condición en el primer THEN, aunque sea de un CASE.
     + (CASE WHEN NEW.tipo::text = 'entrega' THEN -NEW.monto ELSE NEW.monto END) < 0 THEN
    RAISE EXCEPTION 'La entrega supera el dinero por entregar del exhibidor'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entrega_exhibidor_excede';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_entrega_exhibidor() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER entrega_exhibidor_validar BEFORE INSERT ON entrega_exhibidor
  FOR EACH ROW EXECUTE FUNCTION kz_validar_entrega_exhibidor();
--> statement-breakpoint
-- 6. (E-8) Respaldo de cerrarExhibidor: no se cierra con dinero por entregar. Mismo candado que las entregas.
CREATE OR REPLACE FUNCTION public.kz_exhibidor_cierre_sin_dinero() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.estado::text = 'cerrado' AND OLD.estado::text <> 'cerrado' THEN
    PERFORM pg_advisory_xact_lock(hashtext('kz_exhibidor_dinero:' || NEW.id));
    IF public.kz_por_entregar(NEW.id) <> 0 THEN
      RAISE EXCEPTION 'El exhibidor tiene dinero por entregar'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'exhibidor_cierre_con_dinero';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_exhibidor_cierre_sin_dinero() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER exhibidor_cierre_sin_dinero BEFORE UPDATE OF estado ON exhibidor
  FOR EACH ROW EXECUTE FUNCTION kz_exhibidor_cierre_sin_dinero();
--> statement-breakpoint
-- 7. v_exhibidor de 0013 con el dinero al final, siempre con 2 decimales ('0.00', no '0'). CREATE OR REPLACE conserva su GRANT SELECT a kazero_app.
CREATE OR REPLACE VIEW v_exhibidor WITH (security_invoker = true) AS
  SELECT e.id, e.nombre, e.fecha_envio, e.estado, e.version, e.vendedor_id, v.nombre AS vendedor_nombre,
         coalesce(pz.n, 0)::int AS piezas_actuales,
         coalesce(pz.apartadas, 0)::int AS piezas_apartadas,
         coalesce(co.cobrado, 0)::numeric(12,2) AS cobrado,
         coalesce(en.entregado, 0)::numeric(12,2) AS entregado,
         coalesce(en.ajustes, 0)::numeric(12,2) AS ajustes,
         public.kz_por_entregar(e.id)::numeric(12,2) AS por_entregar
  FROM exhibidor e
  JOIN vendedor v ON v.id = e.vendedor_id
  LEFT JOIN (
    SELECT exhibidor_id,
           count(*) FILTER (WHERE estado = 'en_exhibidor') AS n,
           count(*) FILTER (WHERE estado = 'apartada') AS apartadas
    FROM pieza WHERE exhibidor_id IS NOT NULL GROUP BY exhibidor_id
  ) pz ON pz.exhibidor_id = e.id
  LEFT JOIN (
    SELECT exhibidor_id, sum(monto) AS cobrado FROM pago WHERE exhibidor_id IS NOT NULL GROUP BY exhibidor_id
  ) co ON co.exhibidor_id = e.id
  LEFT JOIN (
    SELECT exhibidor_id,
           sum(monto) FILTER (WHERE tipo::text = 'entrega') AS entregado,
           sum(monto) FILTER (WHERE tipo::text = 'ajuste') AS ajustes
    FROM entrega_exhibidor GROUP BY exhibidor_id
  ) en ON en.exhibidor_id = e.id;
--> statement-breakpoint
-- 7b. v_cliente de 0003 con es_mostrador al final: las lecturas excluyen o marcan a «Venta de mostrador» sin subconsultas.
CREATE OR REPLACE VIEW v_cliente WITH (security_invoker = true) AS
  SELECT c.id, c.nombre, c.referencia, c.telefono, c.cumpleanos, c.red_social, c.usuario_red,
         c.vendedor_habitual_id, v.nombre AS vendedor_habitual_nombre, c.notas, c.version,
         c.es_mostrador
  FROM cliente c
  LEFT JOIN vendedor v ON v.id = c.vendedor_habitual_id;
--> statement-breakpoint
-- 8. Privilegios: entregas y ajustes solo se insertan. cliente pasa de UPDATE de tabla (0003) a UPDATE por columna
--    sin id, created_at ni es_mostrador (el REVOKE de tabla quita también los de columna: va primero).
GRANT SELECT, INSERT ON entrega_exhibidor TO kazero_app;
--> statement-breakpoint
REVOKE UPDATE ON cliente FROM kazero_app;
--> statement-breakpoint
GRANT UPDATE (nombre, referencia, telefono, cumpleanos, red_social, usuario_red, vendedor_habitual_id, notas, version,
  updated_at) ON cliente TO kazero_app;
