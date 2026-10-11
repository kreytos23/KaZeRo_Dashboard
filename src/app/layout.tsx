import type { Metadata, Viewport } from 'next';
import { Nunito_Sans } from 'next/font/google';
import './globals.css';

// Todo es panel privado: render dinámico, necesario también para el nonce de la CSP.
export const dynamic = 'force-dynamic';

// next/font descarga la fuente en el build y la sirve desde nuestro dominio (CSP: font-src 'self').
const fuenteMarca = Nunito_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-marca' });

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
