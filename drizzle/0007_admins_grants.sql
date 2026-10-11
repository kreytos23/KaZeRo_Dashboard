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
