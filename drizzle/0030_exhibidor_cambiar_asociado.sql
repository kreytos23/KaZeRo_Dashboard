-- Cambiar el asociado de un exhibidor asignado por error (decisión 2026-11-25). Solo reglas: no cambia ningún dato.
-- kazero_app ya puede actualizar exhibidor.vendedor_id (UPDATE de tabla desde 0003): no hay GRANT nuevo en la tabla.
-- 1. La regla «ya tiene ventas o dinero», en un solo lugar: la usan el trigger (§2), el servicio y la ficha.
--    - cualquier pago cobrado por el exhibidor, también anulado;
--    - cualquier entrega o ajuste;
--    - cualquier pieza que se apartó desde él, aunque la nota se haya cancelado. `a_estado` cubre además las piezas que
--      la migración del Excel dio de alta ya apartadas (movimiento `alta`, sin `apartado`);
--    - cualquier pieza apartada que siga ligada a él.
--    Las piezas en_exhibidor, los envíos y los regresos no cuentan. Invoker: kazero_app lee las cuatro tablas, y cada
--    búsqueda usa el índice de exhibidor_id que ya existe. Los enums se comparan como texto (55P04).
CREATE OR REPLACE FUNCTION public.kz_exhibidor_con_ventas_o_dinero(p_exhibidor uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM public.pago pg WHERE pg.exhibidor_id = p_exhibidor)
      OR EXISTS (SELECT 1 FROM public.entrega_exhibidor en WHERE en.exhibidor_id = p_exhibidor)
      OR EXISTS (SELECT 1 FROM public.movimiento_pieza mp
                 WHERE mp.exhibidor_id = p_exhibidor
                   AND (mp.tipo::text = 'apartado' OR mp.a_estado::text = 'apartada'))
      OR EXISTS (SELECT 1 FROM public.pieza pz
                 WHERE pz.exhibidor_id = p_exhibidor AND pz.estado::text = 'apartada')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_exhibidor_con_ventas_o_dinero(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kz_exhibidor_con_ventas_o_dinero(uuid) TO kazero_app;
--> statement-breakpoint
-- 2. El cambio de asociado: exhibidor abierto, con motivo y sin ventas ni dinero.
--    Carreras: los servicios (venta, nota, abono, entrega, ajuste, cierre) bloquean el exhibidor FOR NO KEY UPDATE antes
--    de escribir, igual que editarExhibidor. Pero una escritura que no lo haga solo toma, por su llave foránea, FOR KEY
--    SHARE, que no choca con este UPDATE. FOR UPDATE sí choca: espera a toda transacción que ya insertó algo de este
--    exhibidor (y la revisión siguiente, con instantánea nueva, la ve) y hace esperar a la que venga después. Aquí no
--    se bloquean piezas ni se toma el candado consultivo del dinero, así que no hay ciclo con quien tiene una pieza o
--    ese candado y espera al exhibidor. Residual: SQL directo que inserta un pago y después su aplicación puede dar
--    40P01 contra este cambio; Postgres revierte una de las dos y la app la traduce a «Intenta de nuevo».
CREATE OR REPLACE FUNCTION public.kz_exhibidor_cambio_asociado() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF OLD.estado::text = 'cerrado' OR NEW.estado::text = 'cerrado' THEN
    RAISE EXCEPTION 'El exhibidor está cerrado: su asociado no cambia'
      USING ERRCODE = 'P0001', CONSTRAINT = 'exhibidor_asociado_cerrado';
  END IF;
  IF nullif(btrim(coalesce(current_setting('kazero.motivo', true), '')), '') IS NULL THEN
    RAISE EXCEPTION 'Falta el motivo del cambio de asociado'
      USING ERRCODE = 'P0001', CONSTRAINT = 'exhibidor_asociado_sin_motivo';
  END IF;
  PERFORM 1 FROM public.exhibidor e WHERE e.id = OLD.id FOR UPDATE;
  IF public.kz_exhibidor_con_ventas_o_dinero(OLD.id) THEN
    RAISE EXCEPTION 'El exhibidor ya tiene ventas o dinero: su asociado no cambia'
      USING ERRCODE = 'P0001', CONSTRAINT = 'exhibidor_asociado_con_ventas';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_exhibidor_cambio_asociado() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS exhibidor_cambio_asociado ON exhibidor;
--> statement-breakpoint
CREATE TRIGGER exhibidor_cambio_asociado BEFORE UPDATE OF vendedor_id ON exhibidor
  FOR EACH ROW WHEN (OLD.vendedor_id IS DISTINCT FROM NEW.vendedor_id)
  EXECUTE FUNCTION kz_exhibidor_cambio_asociado();
--> statement-breakpoint
-- 3. Auditoría: la misma lista de 0009 más vendedor_id, guardado con el nombre del asociado (no el uuid).
DROP TRIGGER IF EXISTS exhibidor_auditoria ON exhibidor;
--> statement-breakpoint
CREATE TRIGGER exhibidor_auditoria AFTER UPDATE OF nombre, fecha_envio, vendedor_id ON exhibidor
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre', 'fecha_envio', 'vendedor_id>vendedor');
