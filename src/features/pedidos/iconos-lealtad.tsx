const BASE = { viewBox: '0 0 32 32', 'aria-hidden': true, focusable: false } as const;
const GEMA = 'var(--color-marca-durazno)';

/** Flor que florece con cada compra: llena (pedido hecho) o de contorno (lugar libre). */
export function Flor({ llena, className }: { llena: boolean; className?: string }) {
  const petalos = (
    <>
      <circle cx="16" cy="8" r="5" />
      <circle cx="24" cy="14" r="5" />
      <circle cx="21" cy="23" r="5" />
      <circle cx="11" cy="23" r="5" />
      <circle cx="8" cy="14" r="5" />
    </>
  );
  return (
    <svg {...BASE} className={className}>
      {llena ? (
        <>
          <g fill="currentColor">{petalos}</g>
          <circle cx="16" cy="16" r="4" fill={GEMA} />
        </>
      ) : (
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          {petalos}
          <circle cx="16" cy="16" r="3.5" />
        </g>
      )}
    </svg>
  );
}

/** Premio del lugar 5. */
export function Anillo({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="16" cy="20" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M12 9l4-5 4 5-4 3z" fill={GEMA} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Premio del lugar 10. */
export function Collar({ className }: { className?: string }) {
  return (
    <svg {...BASE} className={className}>
      <path d="M5 5c2 12 7 17 11 17s9-5 11-17" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M16 22l-3 4 3 4 3-4z" fill={GEMA} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
