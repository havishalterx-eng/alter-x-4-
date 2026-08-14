export function WorkflowVector({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 260 90" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Lines */}
      <path d="M30 45H70" stroke="currentColor" strokeWidth="2" strokeOpacity={active ? 0.8 : 0.2} className="transition-all duration-700" />
      <path d="M90 45H130" stroke="currentColor" strokeWidth="2" strokeOpacity={active ? 0.8 : 0.2} className="transition-all duration-700 delay-100" />
      <path d="M150 45H190" stroke="currentColor" strokeWidth="2" strokeOpacity={active ? 0.8 : 0.2} className="transition-all duration-700 delay-200" />
      <path d="M210 45H230" stroke="currentColor" strokeWidth="2" strokeOpacity={active ? 0.8 : 0.2} className="transition-all duration-700 delay-300" />

      {/* Nodes */}
      {/* 1. Trigger */}
      <circle cx="20" cy="45" r="10" stroke={active ? "var(--ax-orange)" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="2" fill="var(--ax-bg)" className="transition-all duration-500" />
      {/* 2. Processing */}
      <rect x="70" y="35" width="20" height="20" rx="4" stroke="currentColor" strokeOpacity={active ? 1 : 0.5} strokeWidth="2" fill="var(--ax-bg)" className="transition-all duration-500" />
      {/* 3. Decision (Diamond) */}
      <path d="M140 33L152 45L140 57L128 45L140 33Z" stroke="currentColor" strokeOpacity={active ? 1 : 0.5} strokeWidth="2" fill="var(--ax-bg)" className="transition-all duration-500" />
      {/* 4. Action */}
      <rect x="190" y="35" width="20" height="20" rx="4" stroke="currentColor" strokeOpacity={active ? 1 : 0.5} strokeWidth="2" fill="var(--ax-bg)" className="transition-all duration-500" />
      {/* 5. Result */}
      <circle cx="240" cy="45" r="10" stroke={active ? "var(--ax-orange)" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="2" fill={active ? "var(--ax-orange-soft)" : "var(--ax-bg)"} className="transition-all duration-500 delay-300" />

      {/* Active Signal Animation */}
      {active && (
        <circle cx="20" cy="45" r="3" fill="var(--ax-orange)">
          <animate attributeName="cx" values="20;80;140;200;240" dur="1.5s" calcMode="linear" fill="freeze" />
          <animate attributeName="opacity" values="1;1;1;1;0" dur="1.5s" fill="freeze" />
        </circle>
      )}
    </svg>
  )
}
