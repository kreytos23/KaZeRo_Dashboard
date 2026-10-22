import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { categoria, material, origenExcel } from '@/db/schema';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

describe('origen_excel', () => {
  beforeEach(() => reiniciarConAdmin());

  it('exige exactamente una entidad y (lote, clave) única', async () => {
    await conDbUrl(urlOwner(), async (db) => {
      const [cat] = await db.insert(categoria).values({ nombre: 'Prueba' }).returning({ id: categoria.id });
      const base = {
        lote: 'excel-f1',
        clave: 'cat:prueba',
        hoja: 'INVENTARIO',
        hashContenido: 'a'.repeat(64),
      };
      await db.insert(origenExcel).values({ ...base, categoriaId: cat!.id });
      await expect(db.insert(origenExcel).values({ ...base, categoriaId: cat!.id })).rejects.toMatchObject({
        cause: { code: '23505' },
      });
      await expect(db.insert(origenExcel).values({ ...base, clave: 'otra' })).rejects.toMatchObject({
        cause: { constraint: 'origen_excel_una_entidad' },
      });
    });
  });

  it('rechaza dos entidades a la vez y formatos inválidos', async () => {
    await conDbUrl(urlOwner(), async (db) => {
      const [cat] = await db.insert(categoria).values({ nombre: 'Prueba' }).returning({ id: categoria.id });
      const [mat] = await db.insert(material).values({ nombre: 'Prueba' }).returning({ id: material.id });
      const base = { lote: 'excel-f1', clave: 'k', hoja: 'H', hashContenido: 'a'.repeat(64) };
      await expect(
        db.insert(origenExcel).values({ ...base, categoriaId: cat!.id, materialId: mat!.id }),
      ).rejects.toMatchObject({ cause: { constraint: 'origen_excel_una_entidad' } });
      const mal = [
        ['origen_excel_lote_formato', { lote: 'Lote Malo' }],
        ['origen_excel_clave_largo', { clave: '' }],
        ['origen_excel_hoja_largo', { hoja: 'x'.repeat(61) }],
        ['origen_excel_hash_formato', { hashContenido: 'A'.repeat(64) }],
      ] as const;
      for (const [constraint, campos] of mal) {
        await expect(
          db.insert(origenExcel).values({ ...base, ...campos, categoriaId: cat!.id }),
        ).rejects.toMatchObject({ cause: { constraint } });
      }
    });
  });

  it('kazero_app puede leerla pero no escribirla', async () => {
    await conDbUrl(urlApp(), async (db) => {
      await expect(db.select().from(origenExcel)).resolves.toEqual([]);
      await expect(
        db.execute(
          sql`INSERT INTO origen_excel (lote, clave, hoja, hash_contenido) VALUES ('x','x','x', repeat('a',64))`,
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(db.execute(sql`DELETE FROM origen_excel`)).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    });
  });
});
