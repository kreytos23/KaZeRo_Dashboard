-- Plan 4b: referencia y comprobante (P-3, P-4), deshacer un pago (P-5) y sobrante de vendedora (P-2). Reglas que no
-- caben en un CHECK. OJO: 0024 agrega 'anulacion' a tipo_saldo_favor con ADD VALUE y el migrador aplica todo en UNA
-- transacción: aquí nunca se usa como literal del enum (55P04). Siempre `::text = '...'`.

-- 1. (E-5 v2) Por entregar sin los pagos anulados: un pago deshecho no es dinero que el exhibidor tenga.
CREATE OR REPLACE FUNCTION public.kz_por_entregar(p_exhibidor uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
  AS $$
  SELECT (SELECT coalesce(sum(pg.monto), 0) FROM pago pg WHERE pg.exhibidor_id = p_exhibidor AND pg.anulado_at IS NULL)
       + (SELECT coalesce(sum(CASE WHEN e.tipo::text = 'entrega' THEN -e.monto ELSE e.monto END), 0)
            FROM entrega_exhibidor e WHERE e.exhibidor_id = p_exhibidor)
$$;
--> statement-breakpoint
-- 2. Un pago no se edita: solo recibe su comprobante (NULL → valor, una vez) y se anula (NULL → valor, una vez; el
--    CHECK pago_anulacion_coherente exige fecha, motivo y quién juntos). Vale también para el dueño. Los privilegios
--    por columna (sección 8) ya impiden a kazero_app tocar lo demás; esto cubre lo que un privilegio no expresa.
CREATE OR REPLACE FUNCTION public.kz_pago_solo_anular_o_comprobante() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.idempotency_key, NEW.fecha, NEW.monto, NEW.metodo::text, NEW.pagador_cliente_id,
      NEW.pagador_vendedor_id, NEW.nota, NEW.admin_id, NEW.created_at, NEW.exhibidor_id, NEW.referencia)
     IS DISTINCT FROM
     (OLD.id, OLD.idempotency_key, OLD.fecha, OLD.monto, OLD.metodo::text, OLD.pagador_cliente_id,
      OLD.pagador_vendedor_id, OLD.nota, OLD.admin_id, OLD.created_at, OLD.exhibidor_id, OLD.referencia)
     OR (OLD.anulado_at IS NOT NULL
         AND (NEW.anulado_at, NEW.anulacion_motivo, NEW.anulado_por)
             IS DISTINCT FROM (OLD.anulado_at, OLD.anulacion_motivo, OLD.anulado_por))
     OR (OLD.comprobante_clave IS NOT NULL
         AND (NEW.comprobante_clave, NEW.comprobante_sha256)
             IS DISTINCT FROM (OLD.comprobante_clave, OLD.comprobante_sha256)) THEN
    RAISE EXCEPTION 'Un pago solo recibe su comprobante o se anula, una vez'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_solo_anular_o_comprobante';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_pago_solo_anular_o_comprobante() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pago_solo_anular_o_comprobante BEFORE UPDATE ON pago
  FOR EACH ROW EXECUTE FUNCTION kz_pago_solo_anular_o_comprobante();
--> statement-breakpoint
-- 3. (P-5) Anular un pago. Corre después de pago_solo_anular_o_comprobante (orden por nombre):
--    (a) Ninguna aplicación anulada por la cancelación de su pedido. Hoy solo la cancelación anula una aplicación
--        suelta, y ese dinero ya pasó a saldo a favor (R-17): deshacer el pago lo contaría dos veces. Se reconoce por
--        el pedido `cancelado`, no por la fecha: las que el servicio anula al deshacer el pago son de pedidos vivos.
--    (b) (E-5) Lo cobrado por un exhibidor sale de su por entregar, que no queda negativo (cerrado = 0: nunca).
--        Mismo candado consultivo que entregas, ajustes y cierre (0023); el servicio ya tiene el pago (orden de
--        bloqueo: ... → exhibidor → piezas → pago → candados). Antes del UPDATE la suma aún cuenta este pago.
--    Invoker: kazero_app lee aplicacion_pago, pago y entrega_exhibidor.
CREATE OR REPLACE FUNCTION public.kz_validar_anulacion_pago() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.anulado_at IS NOT NULL OR NEW.anulado_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.aplicacion_pago a JOIN public.pedido p ON p.id = a.pedido_id
             WHERE a.pago_id = NEW.id AND a.anulada_at IS NOT NULL AND p.estado::text = 'cancelado') THEN
    RAISE EXCEPTION 'El pago tiene aplicaciones anuladas por una cancelación'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_anulacion_aplicacion_previa';
  END IF;
  IF NEW.exhibidor_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kz_exhibidor_dinero:' || NEW.exhibidor_id, 0));
    IF public.kz_por_entregar(NEW.exhibidor_id) - OLD.monto < 0 THEN
      RAISE EXCEPTION 'El exhibidor quedaría con dinero por entregar negativo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pago_anulacion_exhibidor_negativo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_anulacion_pago() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pago_validar_anulacion BEFORE UPDATE OF anulado_at ON pago
  FOR EACH ROW EXECUTE FUNCTION kz_validar_anulacion_pago();
--> statement-breakpoint
-- 4. kz_validar_aplicacion_pago VERSIÓN 2 = el cuerpo de 0013 + (v2, marcado):
--    - un pago anulado no recibe aplicaciones;
--    - (R-32/P-1) el pago de una vendedora solo se aplica a pedidos suyos (con P-2 su saldo a favor también paga);
--    - (P-2) el tope cuenta el sobrante ya pasado al saldo: aplicaciones vigentes + sobrante ≤ monto.
--    Todo se lee bajo el FOR NO KEY UPDATE del pago, que también toma el sobrante (§5): una anulación o un sobrante
--    concurrentes esperan o ya se ven.
--    Mismo SECURITY DEFINER y search_path; CREATE OR REPLACE conserva el oid, el trigger y el REVOKE.
CREATE OR REPLACE FUNCTION public.kz_validar_aplicacion_pago() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  estado_pedido_tx text;
  vendedor_pedido uuid;
  monto_pago numeric(12,2);
  pago_anulado timestamptz;
  pagador_vendedor uuid;
  aplicado numeric(12,2);
BEGIN
  -- Anular (o una aplicación que nace anulada) solo resta: no hay nada que validar ni bloquear.
  IF NEW.anulada_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.estado::text, p.vendedor_id INTO estado_pedido_tx, vendedor_pedido
    FROM public.pedido p WHERE p.id = NEW.pedido_id FOR NO KEY UPDATE;
  IF estado_pedido_tx = 'cancelado' THEN
    RAISE EXCEPTION 'No se aplican pagos a un pedido cancelado'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_pedido_cancelado';
  END IF;
  SELECT pg.monto, pg.anulado_at, pg.pagador_vendedor_id INTO monto_pago, pago_anulado, pagador_vendedor
    FROM public.pago pg WHERE pg.id = NEW.pago_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- La FK rechaza la fila.
  END IF;
  -- (v2)
  IF pago_anulado IS NOT NULL THEN
    RAISE EXCEPTION 'El pago está anulado'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_pago_anulado';
  END IF;
  -- (v2) R-32/P-1. Un pedido sin encontrar lo rechaza la FK (vendedor_pedido NULL no llega a confirmarse).
  IF pagador_vendedor IS NOT NULL AND vendedor_pedido IS NOT NULL AND vendedor_pedido <> pagador_vendedor THEN
    RAISE EXCEPTION 'El pago de una vendedora solo se aplica a sus pedidos'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_otra_vendedora';
  END IF;
  SELECT coalesce(sum(a.monto), 0) INTO aplicado
    FROM public.aplicacion_pago a
    WHERE a.pago_id = NEW.pago_id AND a.anulada_at IS NULL AND a.id <> NEW.id;
  -- (v2) P-2: el sobrante ya es saldo a favor; no se puede volver a aplicar.
  aplicado := aplicado + coalesce((SELECT s.monto FROM public.saldo_favor_mov s
                                   WHERE s.pago_id = NEW.pago_id AND s.tipo::text = 'sobrante'), 0);
  IF aplicado + NEW.monto > monto_pago THEN
    RAISE EXCEPTION 'Lo aplicado supera el monto del pago'
      USING ERRCODE = 'P0001', CONSTRAINT = 'aplicacion_pago_excede_pago';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- 5. kz_validar_saldo_favor VERSIÓN 3 = el cuerpo de la v2 (0017) SIN CAMBIOS + dos ramas de origen y la anulación
--    en "nunca negativo" (marcadas v3). Mismo trigger saldo_favor_libro (0013): CREATE OR REPLACE conserva el oid.
--    - sobrante (P-2): siempre con su pago (saldo_favor_sobrante_sin_pago; solo al insertar: no revalida filas
--      viejas). Titular = pagador, pago vigente y no de saldo a favor, y sobrante + lo aplicado vigente ≤ monto (el
--      servicio aplica primero y luego registra el sobrante). Toma el pago FOR NO KEY UPDATE, como una aplicación
--      (§4): sobrante y aplicación concurrentes se serializan y ninguno pasa el tope.
--    - anulacion (P-5): el pago ya está anulado (el servicio lo marca antes de escribir el libro), mismo titular y
--      monto = +monto del pago si se pagó con saldo a favor (todo aplicado: lo exige 0017, y 0025 §3a que ninguna
--      se anulara por cancelación), o −su sobrante. Uno por pago (saldo_favor_mov_pago_uq); su pago lo exige saldo_favor_pago_origen.
CREATE OR REPLACE FUNCTION public.kz_validar_saldo_favor() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  saldo_actual numeric(12,2);
  ap record;
  dv record;
  pa record;
  sobrante numeric(12,2);
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
  -- (v3)
  ELSIF NEW.tipo::text = 'sobrante' AND NEW.pago_id IS NULL THEN
    RAISE EXCEPTION 'Un sobrante nace de un pago'
      USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_sobrante_sin_pago';
  ELSIF NEW.tipo::text IN ('sobrante', 'anulacion') AND NEW.pago_id IS NOT NULL THEN
    IF NEW.tipo::text = 'sobrante' THEN
      PERFORM 1 FROM public.pago p WHERE p.id = NEW.pago_id FOR NO KEY UPDATE;
    END IF;
    SELECT p.monto, p.metodo::text AS metodo, p.anulado_at, p.pagador_cliente_id, p.pagador_vendedor_id INTO pa
      FROM public.pago p WHERE p.id = NEW.pago_id;
    IF NOT FOUND THEN
      RETURN NEW; -- La FK rechaza la fila.
    END IF;
    IF NEW.tipo::text = 'sobrante' THEN
      IF pa.anulado_at IS NOT NULL OR pa.metodo = 'saldo_favor'
         OR NEW.cliente_id IS DISTINCT FROM pa.pagador_cliente_id
         OR NEW.vendedor_id IS DISTINCT FROM pa.pagador_vendedor_id
         OR NEW.monto + (SELECT coalesce(sum(a.monto), 0) FROM public.aplicacion_pago a
                         WHERE a.pago_id = NEW.pago_id AND a.anulada_at IS NULL) > pa.monto THEN
        RAISE EXCEPTION 'El sobrante no coincide con su pago'
          USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_sobrante_incoherente';
      END IF;
    ELSE
      SELECT s.monto INTO sobrante
        FROM public.saldo_favor_mov s WHERE s.pago_id = NEW.pago_id AND s.tipo::text = 'sobrante';
      -- Paréntesis obligatorios: el IF de plpgsql corta la condición en el primer THEN, aunque sea de un CASE.
      IF pa.anulado_at IS NULL
         OR NEW.cliente_id IS DISTINCT FROM pa.pagador_cliente_id
         OR NEW.vendedor_id IS DISTINCT FROM pa.pagador_vendedor_id
         OR NEW.monto IS DISTINCT FROM (CASE WHEN pa.metodo = 'saldo_favor' THEN pa.monto ELSE -sobrante END) THEN
        RAISE EXCEPTION 'La anulación no coincide con su pago'
          USING ERRCODE = 'P0001', CONSTRAINT = 'saldo_favor_anulacion_incoherente';
      END IF;
    END IF;
  END IF;
  -- D-22: todo lo que resta (uso, retiro y (v3) quitar un sobrante) se serializa por titular y nunca deja el saldo
  -- negativo. P-5: si el sobrante ya se usó, la anulación no alcanza y falla.
  IF NEW.tipo::text NOT IN ('uso', 'retiro', 'anulacion') OR NEW.monto >= 0 THEN
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
-- 6. (P-5) El dinero no se pierde al anular, revisado al confirmar (constraint trigger DIFERIDO, como 0017): un pago
--    anulado no deja aplicaciones vigentes, y si tenía sobrante o se pagó con saldo a favor, su 'anulacion' está en
--    el libro. Invoker: kazero_app lee aplicacion_pago y saldo_favor_mov. AFTER ROW: RETURN NULL.
CREATE OR REPLACE FUNCTION public.kz_exigir_anulacion_completa() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.anulado_at IS NULL OR OLD.anulado_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.aplicacion_pago a WHERE a.pago_id = NEW.id AND a.anulada_at IS NULL)
     OR ((NEW.metodo::text = 'saldo_favor'
          OR EXISTS (SELECT 1 FROM public.saldo_favor_mov s WHERE s.pago_id = NEW.id AND s.tipo::text = 'sobrante'))
         AND NOT EXISTS (SELECT 1 FROM public.saldo_favor_mov s WHERE s.pago_id = NEW.id AND s.tipo::text = 'anulacion')) THEN
    RAISE EXCEPTION 'Pago anulado sin anular sus aplicaciones o su saldo a favor'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pago_anulado_incompleto';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_exigir_anulacion_completa() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pago_anulacion_completa AFTER UPDATE OF anulado_at ON pago
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kz_exigir_anulacion_completa();
--> statement-breakpoint
-- 7. Vistas. Columnas nuevas SIEMPRE al final y mismas columnas y orden que su última versión: v_aplicacion_pago de
--    0013, v_exhibidor de 0023 y v_saldo_favor_mov de 0017. CREATE OR REPLACE conserva su GRANT SELECT a kazero_app.
--    v_pedido no cambia: anular un pago anula sus aplicaciones (§6), que ya no cuentan en lo pagado.
CREATE OR REPLACE VIEW v_aplicacion_pago WITH (security_invoker = true) AS
  SELECT a.id, a.pedido_id, a.pago_id, a.monto, a.fecha, a.anulada_at, pg.metodo, pg.nota,
         (CASE WHEN pg.pagador_cliente_id IS NOT NULL THEN 'cliente' ELSE 'vendedor' END) AS pagador_tipo,
         coalesce(c.nombre, v.nombre) AS pagador_nombre, a.created_at,
         pg.anulado_at AS pago_anulado_at, pg.referencia
  FROM aplicacion_pago a
  JOIN pago pg ON pg.id = a.pago_id
  LEFT JOIN cliente c ON c.id = pg.pagador_cliente_id
  LEFT JOIN vendedor v ON v.id = pg.pagador_vendedor_id;
--> statement-breakpoint
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
    -- (Plan 4b) Sin los pagos anulados, igual que kz_por_entregar.
    SELECT exhibidor_id, sum(monto) AS cobrado FROM pago
    WHERE exhibidor_id IS NOT NULL AND anulado_at IS NULL GROUP BY exhibidor_id
  ) co ON co.exhibidor_id = e.id
  LEFT JOIN (
    SELECT exhibidor_id,
           sum(monto) FILTER (WHERE tipo::text = 'entrega') AS entregado,
           sum(monto) FILTER (WHERE tipo::text = 'ajuste') AS ajustes
    FROM entrega_exhibidor GROUP BY exhibidor_id
  ) en ON en.exhibidor_id = e.id;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_saldo_favor_mov WITH (security_invoker = true) AS
  SELECT s.id, s.cliente_id, s.vendedor_id, s.tipo, s.monto, s.fecha, s.pedido_id, p.folio AS pedido_folio,
         s.aplicacion_pago_id, s.devolucion_id, d.motivo AS devolucion_motivo, s.nota,
         s.admin_id, ad.email AS admin_email, s.created_at,
         s.pago_id
  FROM saldo_favor_mov s
  LEFT JOIN pedido p ON p.id = s.pedido_id
  LEFT JOIN devolucion d ON d.id = s.devolucion_id
  LEFT JOIN admin ad ON ad.id = s.admin_id;
--> statement-breakpoint
-- 8. Privilegios: de un pago solo se agregan el comprobante y la anulación (también permite su FOR UPDATE). Sin
--    DELETE, como siempre.
GRANT UPDATE (comprobante_clave, comprobante_sha256, anulado_at, anulacion_motivo, anulado_por) ON pago TO kazero_app;
