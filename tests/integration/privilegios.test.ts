import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgCode } from '@/db/errors';
import { truncarTodo, urlApp, urlOwner } from './utilidades';

async function codigoAl(url: string, consulta: ReturnType<typeof sql>) {
  try {
    await conDbUrl(url, (db) => db.execute(consulta));
    return 'ok';
  } catch (e) {
    return pgCode(e) ?? 'sin-codigo';
  }
}

describe('privilegios de kazero_app (mínimo privilegio)', () => {
  it('no puede crear tablas (DDL)', async () => {
    expect(await codigoAl(urlApp(), sql`CREATE TABLE intruso (id int)`)).toBe('42501');
  });
  it('no puede borrar admins ni cambiar su contraseña, correo o rol', async () => {
    expect(await codigoAl(urlApp(), sql`DELETE FROM admin`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET password_hash = 'x'`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET email = 'x@x.mx'`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET rol = 'admin'`)).toBe('42501');
  });
  it('sí puede actualizar el paso TOTP (lo usa el login)', async () => {
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET totp_ultimo_paso = totp_ultimo_paso`)).toBe('ok');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET nombre = 'Kazero'`)).toBe('ok');
    // CHECK admin_nombre_largo (23514): vacío y de más de 60 caracteres se rechazan (INSERT: no depende de que haya filas).
    const alta = (n: ReturnType<typeof sql>) =>
      sql`INSERT INTO admin (email, nombre, password_hash, totp_secret_cifrado) VALUES ('n@n.mx', ${n}, 'h', 'c')`;
    expect(await codigoAl(urlApp(), alta(sql`''`))).toBe('23514');
    expect(await codigoAl(urlApp(), alta(sql`repeat('x', 61)`))).toBe('23514');
  });
  it('no puede reescribir códigos de recuperación ni revivir uno usado', async () => {
    await truncarTodo();
    await conDbUrl(urlOwner(), async (db) => {
      await db.execute(sql`INSERT INTO admin (id, email, password_hash, totp_secret_cifrado)
        VALUES ('00000000-0000-0000-0000-000000000001', 'a@a.mx', 'h', 'c')`);
      await db.execute(sql`INSERT INTO codigo_recuperacion (admin_id, hash, usado_at)
        VALUES ('00000000-0000-0000-0000-000000000001', 'usado', now())`);
    });
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET hash = 'x'`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET admin_id = admin_id`)).toBe('42501');
    // Un código usado no cambia nunca más (trigger), aunque la columna usado_at sea actualizable.
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET usado_at = NULL`)).toBe('P0001');
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET usado_at = now()`)).toBe('P0001');
  });
  it('no puede elegir el rol al insertar un admin', async () => {
    expect(
      await codigoAl(
        urlApp(),
        sql`INSERT INTO admin (email, password_hash, totp_secret_cifrado, rol) VALUES ('r@r.mx','h','c','admin')`,
      ),
    ).toBe('42501');
  });
  it('sí puede leer y escribir sesiones', async () => {
    expect(await codigoAl(urlApp(), sql`SELECT count(*) FROM sesion`)).toBe('ok');
  });
  it('matriz EXACTA de privilegios por columna de kazero_app (admin, codigo_recuperacion y todo UPDATE de columna)', async () => {
    // La parte de tabla de estas tablas ya la fija la matriz de tabla de abajo; aquí solo columnas.
    const [adminCodigo, updates] = await conDbUrl(urlOwner(), (db) =>
      Promise.all([
        db.execute<{ p: string }>(sql`
          SELECT table_name || '.' || column_name || ':' || privilege_type AS p
          FROM information_schema.column_privileges
          WHERE grantee = 'kazero_app' AND table_schema = 'public'
            AND table_name IN ('admin', 'codigo_recuperacion')`),
        db.execute<{ p: string }>(sql`
          SELECT table_name || '.' || column_name AS p FROM information_schema.column_privileges
          WHERE grantee = 'kazero_app' AND table_schema = 'public' AND privilege_type = 'UPDATE'
            AND table_name IN ('auditoria', 'auditoria_campo', 'movimiento_pieza', 'pieza', 'pedido', 'pedido_item', 'aplicacion_pago',
              'corte_comision', 'comision_linea', 'pago_comision', 'cliente', 'entrega_exhibidor', 'pago')`),
      ]),
    );
    const orden = (f: { rows: { p: string }[] }) => f.rows.map((x) => x.p).sort();
    const columnasAdmin = [
      'created_at',
      'email',
      'id',
      'nombre',
      'password_hash',
      'rol',
      'totp_secret_cifrado',
      'totp_ultimo_paso',
      'updated_at',
      'version',
    ];
    const columnasCodigo = ['admin_id', 'created_at', 'hash', 'id', 'usado_at'];
    expect(orden(adminCodigo)).toEqual(
      [
        // SELECT de tabla: el login lee password_hash y el TOTP.
        ...columnasAdmin.map((c) => `admin.${c}:SELECT`),
        // Alta: solo estas columnas (no puede elegir `rol`).
        ...['email', 'nombre', 'password_hash', 'totp_secret_cifrado'].map((c) => `admin.${c}:INSERT`),
        // Regenerar TOTP, el paso del login y el nombre; nunca contraseña, correo ni rol.
        ...['nombre', 'totp_secret_cifrado', 'totp_ultimo_paso', 'updated_at', 'version'].map(
          (c) => `admin.${c}:UPDATE`,
        ),
        ...columnasCodigo.map((c) => `codigo_recuperacion.${c}:SELECT`),
        ...columnasCodigo.map((c) => `codigo_recuperacion.${c}:INSERT`),
        // Solo marcar como usado.
        'codigo_recuperacion.usado_at:UPDATE',
      ].sort(),
    );
    // UPDATE por columna: bitácora e historial no se actualizan (R-06); pieza nunca codigo ni fecha_alta (Plan 2.1);
    // pedido, pedido_item y aplicacion_pago solo lo permitido (R-11, R-27).
    const pedidoCols = [
      'vendedor_id',
      'fecha',
      'estado',
      'descuento_manual_monto',
      'descuento_manual_motivo',
      'total',
      'notas',
      'liquidado_at',
      'cancelado_at',
      'cancelacion_motivo',
      'version',
      'updated_at',
    ];
    const piezaCols = [
      'categoria_id',
      'costo',
      'descripcion',
      'estado',
      'exhibidor_id',
      'foto_path',
      'imagen_clave',
      'material_id',
      'precio',
      'proveedor_id',
      'updated_at',
      'vendedor_custodia_id', // Plan 3.1: entregar/regresar a vendedora
      'version',
    ];
    // Plan 4a: cliente se edita salvo id, created_at y es_mostrador (la clienta de mostrador la fija la BD).
    const clienteCols = [
      'nombre',
      'referencia',
      'telefono',
      'cumpleanos',
      'red_social',
      'usuario_red',
      'vendedor_habitual_id',
      'notas',
      'version',
      'updated_at',
    ];
    expect(orden(updates)).toEqual(
      [
        ...clienteCols.map((c) => `cliente.${c}`),
        ...piezaCols.map((c) => `pieza.${c}`),
        ...pedidoCols.map((c) => `pedido.${c}`),
        ...['vigente', 'quitado_at', 'updated_at'].map((c) => `pedido_item.${c}`),
        'aplicacion_pago.anulada_at',
        // Plan 5a: un pago de comisión solo se anula; cortes y líneas no se actualizan.
        ...['anulado_at', 'anulacion_motivo', 'anulado_por'].map((c) => `pago_comision.${c}`),
        // Plan 4b: un pago solo recibe su comprobante o se anula (lo demás no se edita).
        ...['comprobante_clave', 'comprobante_sha256', 'anulado_at', 'anulacion_motivo', 'anulado_por'].map(
          (c) => `pago.${c}`,
        ),
      ].sort(),
    );
  });
  it('matriz EXACTA de privilegios de tabla de kazero_app en todo public', async () => {
    const r = await conDbUrl(urlOwner(), (db) =>
      db.execute<{ p: string }>(sql`
        SELECT table_name || ':' || privilege_type AS p FROM information_schema.table_privileges
        WHERE grantee = 'kazero_app' AND table_schema = 'public'
          AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')`),
    );
    const t = (tabla: string, ...privs: string[]) => privs.map((p) => `${tabla}:${p}`);
    // La lista se escribe a mano a propósito: si alguien agrega un grant, esta prueba obliga a decidirlo aquí.
    const esperado = [
      ...t('acceso_log', 'INSERT', 'SELECT'), // Plan 5a (D-8): la rotación la hace kz_rotar_acceso_log
      ...t('admin', 'SELECT'),
      ...t('aplicacion_pago', 'INSERT', 'SELECT'),
      ...t('auditoria', 'SELECT'), // Plan 2.1: la escribe solo kz_auditar (SECURITY DEFINER)
      ...t('auditoria_campo', 'SELECT'),
      ...t('categoria', 'INSERT', 'SELECT', 'UPDATE'),
      ...t('cliente', 'INSERT', 'SELECT'), // Plan 4a: UPDATE por columna (nunca es_mostrador)
      ...t('codigo_recuperacion', 'INSERT', 'SELECT'),
      ...t('comision_linea', 'INSERT', 'SELECT'), // Plan 5a: cortes, líneas y pagos no se borran
      ...t('corte_comision', 'INSERT', 'SELECT'),
      ...t('devolucion', 'INSERT', 'SELECT'), // Plan 3.1: no se edita ni se borra
      ...t('entrega_exhibidor', 'INSERT', 'SELECT'), // Plan 4a: entregas y ajustes no se editan ni se borran
      ...t('exhibidor', 'INSERT', 'SELECT', 'UPDATE'),
      ...t('idempotencia', 'DELETE', 'INSERT', 'SELECT', 'UPDATE'),
      ...t('material', 'INSERT', 'SELECT', 'UPDATE'),
      ...t('movimiento_pieza', 'INSERT', 'SELECT'),
      ...t('origen_excel', 'SELECT'), // Plan 7a: solo la escribe el script de migración (dueño)
      ...t('pago', 'INSERT', 'SELECT'), // Plan 4b: UPDATE solo de comprobante y anulación (por columna)
      ...t('pago_comision', 'INSERT', 'SELECT'), // UPDATE solo de las columnas de anulación
      ...t('pedido', 'INSERT', 'SELECT'),
      ...t('pedido_item', 'INSERT', 'SELECT'),
      ...t('pieza', 'INSERT', 'SELECT'), // UPDATE por columna desde el Plan 2.1 (lo vigila su prueba)
      ...t('proveedor', 'INSERT', 'SELECT', 'UPDATE'),
      ...t('saldo_favor_mov', 'INSERT', 'SELECT'),
      ...t('sesion', 'DELETE', 'INSERT', 'SELECT', 'UPDATE'),
      ...t('vendedor', 'INSERT', 'SELECT', 'UPDATE'),
    ].sort();
    expect(r.rows.map((x) => x.p).sort()).toEqual(esperado);
    // Y ninguna tabla de negocio queda sin grants explícitos (una tabla nueva sin GRANT también se detecta).
    const filas = await conDbUrl(urlOwner(), (db) =>
      // Se consulta por oid (no por nombre): el planner puede evaluar el privilegio antes del filtro de
      // esquema y fallar con tablas de otros esquemas (p. ej. drizzle.__drizzle_migrations).
      db.execute<{ tabla: string }>(sql`
        SELECT c.relname AS tabla
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND NOT has_table_privilege('kazero_app', c.oid, 'SELECT')`),
    );
    expect(filas.rows.map((f) => f.tabla)).toEqual([]);
  });
  it('kazero_app no tiene ningún privilegio sobre la secuencia de la bitácora', async () => {
    const r = await conDbUrl(urlOwner(), (db) =>
      db.execute<{ p: boolean }>(sql`
        SELECT has_sequence_privilege('kazero_app', 'public.auditoria_orden_seq', 'USAGE')
            OR has_sequence_privilege('kazero_app', 'public.auditoria_orden_seq', 'SELECT')
            OR has_sequence_privilege('kazero_app', 'public.auditoria_orden_seq', 'UPDATE') AS p`),
    );
    expect(r.rows[0]!.p).toBe(false);
  });
});
