import { eq } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { pago } from '@/db/schema';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { MSG_PAGO_ANULADO } from './mensajes';

export interface Comprobante {
  clave: string;
  sha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** La imagen ya está en el almacén (la acción la sube antes); aquí solo se revisa su forma. */
export function validarComprobante(c: Comprobante | null | undefined): Comprobante | null {
  if (!c) return null;
  if (!UUID.test(c.clave) || !SHA256.test(c.sha256))
    throw new ErrorNegocio('comprobante_invalido', 'El comprobante no es válido.', 'comprobante');
  return { clave: c.clave, sha256: c.sha256 };
}

/**
 * P-3: agrega el comprobante a un pago que no lo tiene (una vez). La misma captura en otro pago vigente la rechaza
 * la BD (`pago_comprobante_sha256_uq`).
 */
export function agregarComprobante(
  db: Ejecutor,
  d: { key: string; adminId: string; pagoId: string; clave: string; sha256: string },
): Promise<{ ok: true }> {
  const c = validarComprobante({ clave: d.clave, sha256: d.sha256 })!;
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        {
          key: d.key,
          adminId: d.adminId,
          operacion: 'agregarComprobante',
          payload: { pagoId: d.pagoId, sha256: c.sha256 }, // la huella, no la clave aleatoria (I-2)
        },
        async (): Promise<{ ok: true }> => {
          const [p] = await tx
            .select({ anuladoAt: pago.anuladoAt, clave: pago.comprobanteClave })
            .from(pago)
            .where(eq(pago.id, d.pagoId))
            .for('no key update');
          if (!p) throw new ErrorNegocio('no_encontrado', 'El pago no existe.');
          if (p.anuladoAt) throw new ErrorNegocio('pago_anulado', MSG_PAGO_ANULADO);
          if (p.clave) throw new ErrorNegocio('comprobante_existente', 'El pago ya tiene comprobante.');
          await tx
            .update(pago)
            .set({ comprobanteClave: c.clave, comprobanteSha256: c.sha256 })
            .where(eq(pago.id, d.pagoId));
          return { ok: true };
        },
      ),
    ),
  );
}
