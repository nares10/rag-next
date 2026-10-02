interface UsageRingProps {
  used: number;
  limit: number;
}

/** Free messages are worth a glance only near the end, so the ring stays quiet until then. */
const WARN_AT = 0.75;

export default function UsageRing({ used, limit }: UsageRingProps) {
  const ratio = Math.min(1, used / limit);
  const remaining = Math.max(0, limit - used);
  const isWarning = ratio >= WARN_AT;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = ratio >= 1 ? "text-rose-400" : isWarning ? "text-amber-400" : "text-zinc-500";

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs ${isWarning ? color : "text-zinc-500"}`}
      title={`${used} of ${limit} free messages used`}
      aria-label={`${remaining} free messages left`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" className={`-rotate-90 ${color}`} aria-hidden="true">
        <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      {isWarning && <span className="font-medium">{remaining === 0 ? "No free messages left" : `${remaining} left`}</span>}
    </div>
  );
}
