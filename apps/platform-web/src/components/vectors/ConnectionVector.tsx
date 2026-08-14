export function ConnectionVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 70" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left system */}
      <rect x="10" y="20" width="60" height="30" rx="5" fill="var(--ax-bg)" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
      <text x="40" y="39" fill="currentColor" opacity="0.5" fontSize="8" textAnchor="middle" fontWeight="600" className="font-sans">EXTERNAL</text>

      {/* Bridge */}
      <path d="M70 35H100" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M160 35H190" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />

      {/* Bridge center - controlled link */}
      <rect x="100" y="22" width="60" height="26" rx="4" fill="var(--ax-bg)" stroke="var(--ax-orange)" strokeWidth="2" />
      {/* Link icon inside */}
      <path d="M122 31C122 28 125 25 128 25H132C135 25 138 28 138 31" stroke="var(--ax-orange)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M122 39C122 42 125 45 128 45H132C135 45 138 42 138 39" stroke="var(--ax-orange)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <line x1="126" y1="35" x2="134" y2="35" stroke="var(--ax-orange)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Right system */}
      <rect x="190" y="20" width="60" height="30" rx="5" fill="var(--ax-bg)" stroke="var(--ax-orange)" strokeOpacity="0.6" strokeWidth="1.5" />
      <text x="220" y="39" fill="var(--ax-orange)" fontSize="8" textAnchor="middle" fontWeight="700" className="font-sans">ALTERX</text>

      {/* Signal flowing */}
      <circle r="2" fill="var(--ax-orange)">
        <animate attributeName="cx" values="70;100;160;190" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="cy" values="35;35;35;35" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" dur="1.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}
