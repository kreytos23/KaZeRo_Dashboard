import Image from 'next/image';

/** Marco de las pantallas de acceso: logo completo con lema y el formulario en una tarjeta. */
export function MarcoAcceso({ children }: { children: React.ReactNode }) {
  return (
    <main className="fondo-acuarela flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {/* webp 3x ya optimizado; carga inmediata porque es lo primero que se ve. */}
        <Image
          src="/marca/logo-completo.webp"
          alt="KaZeRo. Vida, moda y estilo"
          width={160}
          height={223}
          unoptimized
          loading="eager"
          className="h-auto w-32 sm:w-40"
        />
        <div className="flex w-full flex-col gap-6 rounded-2xl border border-borde bg-white/90 p-6 shadow-[0_12px_40px_-16px_rgb(165_78_41/0.25)] sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
