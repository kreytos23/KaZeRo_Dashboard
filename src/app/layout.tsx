import type { Metadata, Viewport } from 'next';
import './globals.css';

// Todo es panel privado: render dinámico, necesario también para el nonce de la CSP.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kazero',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body className="min-h-dvh bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
