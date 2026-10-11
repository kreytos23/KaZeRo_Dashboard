-- Gestión de administradores desde el panel (Plan 2): la app puede dar de alta admins y regenerar su TOTP,
-- pero ya no puede cambiar contraseña, correo ni rol de nadie (UPDATE por columna).
REVOKE UPDATE ON admin FROM kazero_app;
--> statement-breakpoint
GRANT UPDATE (totp_secret_cifrado, totp_ultimo_paso, version, updated_at) ON admin TO kazero_app;
--> statement-breakpoint
GRANT INSERT ON admin, codigo_recuperacion TO kazero_app;
--> statement-breakpoint
-- updated_at por trigger también en admin (regla de diseño de BD).
CREATE TRIGGER admin_updated_at BEFORE UPDATE ON admin FOR EACH ROW EXECUTE FUNCTION kz_tocar_updated_at();

--> statement-breakpoint
-- La app solo puede elegir las columnas que el alta realmente usa: no puede fijar `rol` (queda su DEFAULT). El alta usa INSERT crudo: Drizzle listaría todas las columnas (con DEFAULT) y exigiría privilegio sobre `rol`.
REVOKE INSERT ON admin FROM kazero_app;
--> statement-breakpoint
GRANT INSERT (email, password_hash, totp_secret_cifrado) ON admin TO kazero_app;
--> statement-breakpoint
-- Códigos de recuperación: la app solo puede marcarlos como usados (usado_at). No puede reescribir hash ni admin_id
-- (implantar un código) ni, por el trigger, revivir uno ya usado.
REVOKE UPDATE ON codigo_recuperacion FROM kazero_app;
--> statement-breakpoint
GRANT UPDATE (usado_at) ON codigo_recuperacion TO kazero_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.kz_codigo_recuperacion_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.usado_at IS NOT NULL THEN
    -- CONSTRAINT lo expone a pgConstraint() para traducirlo a un mensaje de negocio.
    RAISE EXCEPTION 'Un código de recuperación usado no puede modificarse'
      USING ERRCODE = 'P0001', CONSTRAINT = 'codigo_recuperacion_usado';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER codigo_recuperacion_inmutable BEFORE UPDATE ON codigo_recuperacion FOR EACH ROW EXECUTE FUNCTION kz_codigo_recuperacion_inmutable();
--> statement-breakpoint
-- Vista de solo lectura para listar administradores (regla del proyecto: lecturas por vistas). kazero_app conserva
-- SELECT sobre las columnas sensibles de admin porque el login las necesita (password_hash, TOTP); la vista existe
-- por la regla y para no exponerlas en los listados.
CREATE VIEW v_admin WITH (security_invoker = true) AS
  SELECT id, email, created_at FROM admin;
--> statement-breakpoint
GRANT SELECT ON v_admin TO kazero_app;
