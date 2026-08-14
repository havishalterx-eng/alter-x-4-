export function HumanActionVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 80" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Execution path arrives */}
      <path d="M20 40H80" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      {/* Gate */}
      <path d="M80 40H120" stroke="var(--ax-orange)" strokeWidth="2" strokeDasharray="4 3" />
      {/* After gate */}
      <path d="M180 40H240" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />

      {/* Start node */}
      <circle cx="20" cy="40" r="6" fill="currentColor" opacity="0.3" />

      {/* Decision gate (diamond) */}
      <path d="M150 18L172 40L150 62L128 40L150 18Z" stroke="var(--ax-orange)" strokeWidth="2" fill="var(--ax-bg)" />
      {/* Person icon inside gate */}
      <circle cx="150" cy="33" r="5" stroke="var(--ax-orange)" strokeWidth="1.5" fill="none" />
      <path d="M142 48C142 44 146 41 150 41C154 41 158 44 158 48" stroke="var(--ax-orange)" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Waiting pulse */}
      <circle cx="150" cy="40" r="24" stroke="var(--ax-orange)" strokeWidth="1" strokeOpacity="0.3">
        <animate attributeName="r" values="24;32;24" dur="2.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.5s" repeatCount="indefinite" />
      </circle>

      {/* End node */}
      <circle cx="240" cy="40" r="6" fill="currentColor" opacity="0.15" />
    </svg>
  )
}
