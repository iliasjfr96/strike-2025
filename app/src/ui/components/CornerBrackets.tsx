// STRIKE 2025 — <CornerBrackets> (design.md §10)
// 4 équerres d'angle en L réutilisables, posées en dépassement du parent
// (qui doit être en position relative). Présentation pure.

interface CornerBracketsProps {
  /** Longueur de chaque branche du L (px). */
  size?: number;
  /** Couleur du trait (token CSS). */
  color?: string;
  /** Épaisseur du trait (px). */
  strokeWidth?: number;
  /** Dépassement par rapport au coin du parent (px, §6 : 4). */
  offset?: number;
  className?: string;
}

function L({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <path
        d={`M0 ${size} L0 0 L${size} 0`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
      />
    </svg>
  );
}

export function CornerBrackets({
  size = 8,
  color = 'var(--line-strong)',
  strokeWidth = 1.5,
  offset = 4,
  className,
}: CornerBracketsProps) {
  const corners = [
    { style: { top: -offset, left: -offset } },
    { style: { top: -offset, right: -offset, transform: 'scaleX(-1)' } },
    { style: { bottom: -offset, right: -offset, transform: 'scale(-1, -1)' } },
    { style: { bottom: -offset, left: -offset, transform: 'scaleY(-1)' } },
  ] as const;
  return (
    <span className={`pointer-events-none absolute inset-0 ${className ?? ''}`} aria-hidden="true">
      {corners.map((c, i) => (
        <span key={i} className="absolute" style={c.style}>
          <L size={size} color={color} strokeWidth={strokeWidth} />
        </span>
      ))}
    </span>
  );
}
