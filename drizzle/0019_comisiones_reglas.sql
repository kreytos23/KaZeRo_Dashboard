-- Plan 5a: cortes, líneas y pagos de comisión (D-1, D-3) y rotación de acceso_log (D-8). Reglas que no caben en
-- un CHECK. metodo_pago_comision nace con CREATE TYPE en 0018 (no ADD VALUE), pero igual que en 0017 se compara
-- como `::text` para no depender de eso.

-- 1. (D-3) Fecha de liquidación: la mayor fecha de cobro vigente; si no hubo cobro (total 0), el día en México
--    en que se liquidó. Invoker: kazero_app lee aplicacion_pago y pedido.
CREATE OR REPLACE FUNCTION public.kz_fecha_liquidacion(p_pedido uuid) RETURNS date
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
  AS $$
  SELECT COALESCE(
    (SELECT max(ap.fecha) FROM aplicacion_pago ap WHERE ap.pedido_id = p_pedido AND ap.anulada_at IS NULL),
    (SELECT (p.liquidado_at AT TIME ZONE 'America/Mexico_City')::date FROM pedido p WHERE p.id = p_pedido))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_fecha_liquidacion(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kz_fecha_liquidacion(uuid) TO kazero_app;
--> statement-breakpoint
-- 2. Una línea comisiona un pedido liquidado, a su vendedora y sobre su total (lo que protege el dinero). Que un
--    pedido se comisione una sola vez lo da comision_linea_pedido_uq. La fecha y el mes los decide el servicio con
--    kz_fecha_liquidacion en la misma transacción. FOR SHARE: el pedido no cambia hasta que confirme la línea
--    (el servicio ya lo tiene FOR UPDATE, así que aquí no espera).
CREATE OR REPLACE FUNCTION public.kz_validar_comision_linea() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  p record;
BEGIN
  SELECT pe.estado::text AS estado, pe.vendedor_id, pe.total INTO p
    FROM public.pedido pe WHERE pe.id = NEW.pedido_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW; -- La FK rechaza la fila.
  END IF;
  IF p.estado <> 'liquidado' OR NEW.vendedor_id <> p.vendedor_id OR NEW.base <> p.total THEN
    RAISE EXCEPTION 'La línea de comisión no coincide con el pedido liquidado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'comision_linea_coherente';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_comision_linea() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER comision_linea_validar BEFORE INSERT ON comision_linea
  FOR EACH ROW EXECUTE FUNCTION kz_validar_comision_linea();
--> statement-breakpoint
-- 3. Se paga exactamente lo comisionado a la vendedora en el corte (Σ de sus líneas, > 0), y el pago nace
--    vigente. Las líneas se insertan al cerrar el corte, que no se edita: la suma ya no cambia.
CREATE OR REPLACE FUNCTION public.kz_validar_pago_comision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Un pago de comisión nace vigente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_comision_nace_vigente';
  END IF;
  IF NEW.monto <= 0 OR NEW.monto IS DISTINCT FROM (
       SELECT sum(l.monto) FROM public.comision_linea l
       WHERE l.corte_id = NEW.corte_id AND l.vendedor_id = NEW.vendedor_id) THEN
    RAISE EXCEPTION 'El pago no coincide con la comisión del corte'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_comision_monto_coherente';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_pago_comision() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pago_comision_validar BEFORE INSERT ON pago_comision
  FOR EACH ROW EXECUTE FUNCTION kz_validar_pago_comision();
--> statement-breakpoint
-- 4. Un pago solo se anula, una vez: cambian únicamente las tres columnas de anulación y solo si estaba vigente
--    (el CHECK pago_comision_anulacion exige las tres juntas). Vale también para el dueño.
CREATE OR REPLACE FUNCTION public.kz_pago_comision_solo_anular() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.anulado_at IS NOT NULL
     OR (NEW.id, NEW.corte_id, NEW.vendedor_id, NEW.fecha, NEW.monto, NEW.metodo::text, NEW.nota, NEW.admin_id,
         NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.corte_id, OLD.vendedor_id, OLD.fecha, OLD.monto, OLD.metodo::text, OLD.nota, OLD.admin_id,
         OLD.created_at) THEN
    RAISE EXCEPTION 'Un pago de comisión solo se anula, una vez'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_comision_inmutable';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_pago_comision_solo_anular() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pago_comision_solo_anular BEFORE UPDATE ON pago_comision
  FOR EACH ROW EXECUTE FUNCTION kz_pago_comision_solo_anular();
--> statement-breakpoint
-- 5. (D-8) Rotación de acceso_log a 180 días. SECURITY DEFINER de dueño con search_path fijo: kazero_app pierde
--    el DELETE directo que le dio 0001 para esta misma rotación y solo puede ejecutar esta función.
CREATE OR REPLACE FUNCTION public.kz_rotar_acceso_log() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  WITH b AS (DELETE FROM public.acceso_log WHERE created_at < now() - interval '180 days' RETURNING 1)
  SELECT count(*)::int FROM b
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_rotar_acceso_log() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.kz_rotar_acceso_log() TO kazero_app;
--> statement-breakpoint
REVOKE DELETE ON acceso_log FROM kazero_app;
--> statement-breakpoint
-- 6. Privilegios (D-1): cortes y líneas solo se insertan; un pago se inserta y solo se anula. Nada se borra.
GRANT SELECT, INSERT ON corte_comision, comision_linea TO kazero_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON pago_comision TO kazero_app;
--> statement-breakpoint
GRANT UPDATE (anulado_at, anulacion_motivo, anulado_por) ON pago_comision TO kazero_app;
