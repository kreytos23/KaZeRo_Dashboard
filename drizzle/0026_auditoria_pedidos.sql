-- Reglas que la revisión de seguridad encontró sin barrera en la BD. Ambas repiten lo que ya exige el servicio.
-- 1. kz_validar_transicion_pedido VERSIÓN 3 = la v2 (0025) SIN CAMBIOS + un agregado (v3, marcado): un pedido con
--    comisión cerrada no se cancela. comision_linea es de solo inserción, así que la línea seguiría pagable sobre un
--    pedido sin ingreso. Invoker: kazero_app lee comision_linea. El trigger pedido_transicion la llama por nombre.
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
  -- (v2) Un pedido con devoluciones no se cancela.
  IF OLD.estado::text <> 'cancelado' AND NEW.estado::text = 'cancelado'
     AND EXISTS (SELECT 1 FROM public.devolucion d JOIN public.pedido_item i ON i.id = d.pedido_item_id
                 WHERE i.pedido_id = NEW.id) THEN
    RAISE EXCEPTION 'Un pedido con devoluciones no se cancela'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pedido_cancelado_con_devoluciones';
  END IF;
  -- (v3) Un pedido con comisión cerrada no se cancela.
  IF OLD.estado::text <> 'cancelado' AND NEW.estado::text = 'cancelado'
     AND EXISTS (SELECT 1 FROM public.comision_linea c WHERE c.pedido_id = NEW.id) THEN
    RAISE EXCEPTION 'Un pedido con comisión cerrada no se cancela'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pedido_cancelado_con_comision';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- 2. (R-32/P-1, E-4) kz_validar_aplicacion_pago y pago_exhibidor_coherente solo corren al escribir la aplicación: esto
--    cubre el otro lado, cambiar la vendedora de un pedido que ya tiene pagos suyos o de su exhibidor. Las aplicaciones
--    vigentes ya tienen el pedido bloqueado al insertarse, y el UPDATE también: no hay carrera. Invoker: kazero_app lee
--    aplicacion_pago, pago y exhibidor.
CREATE FUNCTION public.kz_validar_vendedor_con_pagos() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.aplicacion_pago a
      JOIN public.pago pg ON pg.id = a.pago_id
      LEFT JOIN public.exhibidor e ON e.id = pg.exhibidor_id
    WHERE a.pedido_id = NEW.id AND a.anulada_at IS NULL
      AND (pg.pagador_vendedor_id <> NEW.vendedor_id OR e.vendedor_id <> NEW.vendedor_id)
  ) THEN
    RAISE EXCEPTION 'El pedido tiene pagos de su vendedora o de su exhibidor'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pedido_vendedor_con_pagos';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pedido_vendedor_con_pagos BEFORE UPDATE OF vendedor_id ON pedido
  FOR EACH ROW WHEN (OLD.vendedor_id IS DISTINCT FROM NEW.vendedor_id)
  EXECUTE FUNCTION public.kz_validar_vendedor_con_pagos();
