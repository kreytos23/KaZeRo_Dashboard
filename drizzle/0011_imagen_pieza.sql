-- Plan 2.2: foto por pieza (R-38). 0010 agregó pieza.imagen_clave (uuid NULL).
-- Sin motivo: no es dinero. Sin índice ni FK: no apunta a otra tabla ni se busca por ella. Sin CHECK: el tipo
-- uuid ya valida el formato. No se usa ningún valor de enum nuevo (0010 y 0011 corren en UNA transacción).

-- 1. Auditoría: el cambio de foto aparece en "Historial de cambios". kz_auditar (0009) no cambia: conserva
--    SECURITY DEFINER, search_path fijo, dueño y el REVOKE de PUBLIC. Solo se recrea el trigger con la columna
--    nueva (mismas columnas y argumentos que 0009 + imagen_clave). DEBE coincidir con ETIQUETA_CAMPO/textoCambio.
--    `UPDATE OF` sigue sin incluir estado/exhibidor_id/version: cambiar la foto funciona en cualquier estado
--    (también en piezas vendidas) porque no toca la máquina de estados.
DROP TRIGGER pieza_auditoria ON pieza;
--> statement-breakpoint
CREATE TRIGGER pieza_auditoria AFTER UPDATE OF descripcion, categoria_id, material_id, proveedor_id, costo, precio, imagen_clave ON pieza
  FOR EACH ROW EXECUTE FUNCTION kz_auditar('descripcion', 'categoria_id>categoria', 'material_id>material', 'proveedor_id>proveedor', 'costo', 'precio', 'imagen_clave');
--> statement-breakpoint
-- 2. Lectura sin N+1: la clave sale con la pieza. Columna nueva AL FINAL (CREATE OR REPLACE lo exige) y
--    mismas columnas y orden que 0003. El GRANT SELECT a kazero_app se conserva.
CREATE OR REPLACE VIEW v_pieza WITH (security_invoker = true) AS
  SELECT p.id, p.codigo, p.descripcion, p.costo, p.precio, p.fecha_alta, p.estado, p.version,
         p.categoria_id, cat.nombre AS categoria_nombre,
         p.material_id, m.nombre AS material_nombre,
         p.proveedor_id, pr.nombre AS proveedor_nombre,
         p.exhibidor_id, e.nombre AS exhibidor_nombre,
         p.imagen_clave
  FROM pieza p
  JOIN categoria cat ON cat.id = p.categoria_id
  LEFT JOIN material m ON m.id = p.material_id
  LEFT JOIN proveedor pr ON pr.id = p.proveedor_id
  LEFT JOIN exhibidor e ON e.id = p.exhibidor_id;
--> statement-breakpoint
-- 3. Privilegios: la app cambia la foto por columna (el UPDATE de pieza es por columna desde 0009; codigo y
--    fecha_alta siguen sin UPDATE). El INSERT de pieza es por tabla, así que el alta ya puede traer la clave.
GRANT UPDATE (imagen_clave) ON pieza TO kazero_app;
