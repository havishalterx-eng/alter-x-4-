export function EventVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 60" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30 30H270" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" strokeDasharray="4 4" />
      
      {/* Event */}
      <circle cx="30" cy="30" r="8" fill="var(--ax-orange)" />
      <text x="30" y="55" fill="currentColor" opacity="0.6" fontSize="10" textAnchor="middle" fontWeight="600" className="uppercase font-sans">Event</text>

      {/* Trigger */}
      <rect x="95" y="22" width="16" height="16" rx="3" fill="var(--ax-bg)" stroke="var(--ax-orange)" strokeWidth="2" />
      <text x="103" y="55" fill="currentColor" opacity="0.6" fontSize="10" textAnchor="middle" fontWeight="600" className="uppercase font-sans">Trigger</text>

      {/* Workflow */}
      <circle cx="180" cy="30" r="10" fill="var(--ax-bg)" stroke="var(--ax-orange)" strokeWidth="2" />
      <circle cx="180" cy="30" r="4" fill="var(--ax-orange)" />
      <text x="180" y="55" fill="currentColor" opacity="0.6" fontSize="10" textAnchor="middle" fontWeight="600" className="uppercase font-sans">Workflow</text>

      {/* Run */}
      <path d="M260 20L280 30L260 40Z" fill="var(--ax-bg)" stroke="var(--ax-orange)" strokeWidth="2" />
      <text x="270" y="55" fill="currentColor" opacity="0.6" fontSize="10" textAnchor="middle" fontWeight="600" className="uppercase font-sans">Run</text>

      {/* Active pulse */}
      <circle cx="30" cy="30" r="3" fill="var(--ax-bg)">
        <animate attributeName="cx" values="30; 103; 180; 270; 300" dur="2s" calcMode="linear" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;1;1;1;0" dur="2s" fill="freeze" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}
