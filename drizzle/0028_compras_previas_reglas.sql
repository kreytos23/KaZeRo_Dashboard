-- Compras previas de la tarjeta (diseño 2026-11-16, L-1 a L-5). Lo que no cabe en un CHECK.
-- 1. v_cliente con compras_previas al final (CREATE OR REPLACE solo admite columnas nuevas al final).
CREATE OR REPLACE VIEW v_cliente WITH (security_invoker = true) AS
  SELECT c.id, c.nombre, c.referencia, c.telefono, c.cumpleanos, c.red_social, c.usuario_red,
         c.vendedor_habitual_id, v.nombre AS vendedor_habitual_nombre, c.notas, c.version,
         c.es_mostrador, c.compras_previas
  FROM cliente c
  LEFT JOIN vendedor v ON v.id = c.vendedor_habitual_id;
--> statement-breakpoint
GRANT UPDATE (compras_previas) ON cliente TO kazero_app;
--> statement-breakpoint
-- 2. (L-4) Ninguna nota vigente ocupa un lugar previo. La clienta ya está bloqueada al crear la nota.
CREATE OR REPLACE FUNCTION public.kz_pedido_fuera_de_previas() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF NEW.cuenta_tarjeta AND NEW.ciclo_tarjeta = 1 AND NEW.estado::text <> 'cancelado'
     AND NEW.posicion_tarjeta <= (SELECT c.compras_previas FROM public.cliente c WHERE c.id = NEW.cliente_id) THEN
    RAISE EXCEPTION 'El lugar % de la tarjeta es una compra anterior', NEW.posicion_tarjeta
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pedido_lugar_previo';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_pedido_fuera_de_previas() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pedido_lugar_previo BEFORE INSERT OR UPDATE OF cliente_id, cuenta_tarjeta, ciclo_tarjeta, posicion_tarjeta
  ON pedido FOR EACH ROW EXECUTE FUNCTION kz_pedido_fuera_de_previas();
--> statement-breakpoint
-- 3. (L-5) Corregirlas exige motivo y que la clienta no tenga notas vigentes en su primera tarjeta. El UPDATE
--    bloquea la fila de la clienta: una nota concurrente (que la bloquea primero) espera o es esperada.
CREATE OR REPLACE FUNCTION public.kz_validar_compras_previas() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF nullif(btrim(coalesce(current_setting('kazero.motivo', true), '')), '') IS NULL THEN
    RAISE EXCEPTION 'Falta el motivo del cambio de compras previas'
      USING ERRCODE = 'P0001', CONSTRAINT = 'cliente_previas_sin_motivo';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pedido p WHERE p.cliente_id = NEW.id AND p.cuenta_tarjeta
             AND p.ciclo_tarjeta = 1 AND p.estado::text <> 'cancelado') THEN
    RAISE EXCEPTION 'La clienta ya tiene notas en su primera tarjeta'
      USING ERRCODE = 'P0001', CONSTRAINT = 'cliente_previas_con_notas';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kz_validar_compras_previas() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER cliente_compras_previas BEFORE UPDATE OF compras_previas ON cliente
  FOR EACH ROW WHEN (OLD.compras_previas IS DISTINCT FROM NEW.compras_previas)
  EXECUTE FUNCTION kz_validar_compras_previas();
--> statement-breakpoint
-- 4. Auditoría: la misma lista de 0009 más compras_previas.
DROP TRIGGER cliente_auditoria ON cliente;
--> statement-breakpoint
CREATE TRIGGER cliente_auditoria AFTER UPDATE OF nombre, referencia, telefono, cumpleanos, red_social, usuario_red,
  vendedor_habitual_id, notas, compras_previas ON cliente
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('nombre', 'referencia', 'telefono', 'cumpleanos', 'red_social',
  'usuario_red', 'vendedor_habitual_id>vendedor', 'notas', 'compras_previas');
