import { describe, expect, it } from 'vitest';
import { qrComoDataUrl } from '@/server/auth/qr';

describe('QR del TOTP', () => {
  it('genera un SVG en data URL (permitido por img-src data: de la CSP)', async () => {
    const url = await qrComoDataUrl('otpauth://totp/Kazero:a%40b.mx?secret=JBSWY3DPEHPK3PXP&issuer=Kazero');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(url.split(',')[1]!, 'base64').toString()).toContain('<svg');
  });
});
