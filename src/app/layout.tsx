import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Todo es panel privado: render dinámico, necesario también para el nonce de la CSP.
export const dynamic = 'force-dynamic';

// Nunito Sans (OFL, ver fonts/OFL.txt) vive en el repo: el build no depende de Google Fonts y se sirve
// desde nuestro dominio (CSP: font-src 'self'). Un solo archivo variable (latin, pesos 200-1000).
const fuenteMarca = localFont({
  src: './fonts/nunito-sans-latin-wght.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  variable: '--font-marca',
  adjustFontFallback: 'Arial',
});

export const metadata: Metadata = {
  title: { default: 'Kazero', template: '%s · Kazero' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#fcf6f0' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={fuenteMarca.variable}>
      <body className="min-h-dvh bg-crema font-sans text-tinta antialiased">{children}</body>
    </html>
  );
}
