-- Nombre opcional del administrador (saludo del inicio). La app lo escribe al dar de alta y al editarlo; el resto de
-- columnas de admin sigue sin permiso de escritura. La vista suma `nombre` AL FINAL (CREATE OR REPLACE VIEW exige
-- conservar el orden de las columnas existentes); SELECT de tabla ya cubre la columna nueva.
GRANT INSERT (nombre), UPDATE (nombre) ON admin TO kazero_app;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_admin WITH (security_invoker = true) AS
  SELECT id, email, created_at, nombre FROM admin;
