-- Rol de runtime con mínimo privilegio (diseño §7.1). Se crea por SQL y no por la API de Neon,
-- porque los roles creados por API heredan neon_superuser (CREATEDB, CREATEROLE).
-- Nace NOLOGIN; scripts/configurar-bd.ts y scripts/test-neon.ts le ponen LOGIN y contraseña.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kazero_app') THEN
    CREATE ROLE kazero_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kazero_app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
-- Grants explícitos por tabla: cada migración futura que cree una tabla debe agregar los suyos
-- (la prueba "toda tabla tiene grants" lo vigila).
GRANT SELECT, UPDATE ON admin TO kazero_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON codigo_recuperacion TO kazero_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sesion TO kazero_app;
--> statement-breakpoint
-- DELETE permitido solo para la rotación de 180 días (diseño §7.2).
GRANT SELECT, INSERT, DELETE ON acceso_log TO kazero_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotencia TO kazero_app;
