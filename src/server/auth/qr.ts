import QRCode from 'qrcode';

/** QR como data URL: la CSP permite img-src data:, así que no se sirve desde ningún tercero. */
export async function qrComoDataUrl(texto: string): Promise<string> {
  const svg = await QRCode.toString(texto, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
