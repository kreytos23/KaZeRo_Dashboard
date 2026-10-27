import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

let png: Promise<Buffer> | undefined;

/** react-pdf no lee webp: se convierte una vez a PNG y se reutiliza. */
export function logoPng(): Promise<Buffer> {
  png ??= readFile(join(process.cwd(), 'public', 'marca', 'logo-horizontal.webp'))
    .then((b) => sharp(b).png().toBuffer())
    .catch((e: unknown) => {
      png = undefined; // no memoizar el fallo
      throw e;
    });
  return png;
}
