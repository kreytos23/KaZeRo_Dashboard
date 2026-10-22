-- Plan 7a (D-5). Solo el script de migración (dueño) escribe; la app solo podría leer (insignia "histórico", R-48).
-- 0014 + 0015 se aplican en UNA transacción: aquí no se usa ningún literal de enum nuevo (no hay ninguno).
GRANT SELECT ON origen_excel TO kazero_app;
--> statement-breakpoint
COMMENT ON TABLE origen_excel IS 'Plan 7a: fila de Excel de la que salió cada entidad migrada (lote, clave estable, hash). Solo inserción por el dueño.';
