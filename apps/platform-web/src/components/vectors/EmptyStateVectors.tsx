export function EmptyWorkflowVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 120" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="90" cy="80" r="10" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="140" cy="40" r="10" stroke="currentColor" strokeOpacity="0.1" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M50 40L80 80" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M100 80L130 40" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="90" cy="60" r="3" fill="var(--ax-orange)" opacity="0.6" />
    </svg>
  )
}

export function EmptyRunVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 80" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 40H160" stroke="currentColor" strokeOpacity="0.1" strokeWidth="2" strokeDasharray="6 4" />
      <circle cx="20" cy="40" r="5" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
      <circle cx="90" cy="40" r="5" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.5" />
      <circle cx="160" cy="40" r="5" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" />
      <path d="M85 35L95 40L85 45" fill="var(--ax-orange)" opacity="0.4" />
    </svg>
  )
}

export function EmptyKnowledgeVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="40" y="10" width="80" height="24" rx="5" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="80" y="26" fill="currentColor" opacity="0.15" fontSize="9" textAnchor="middle" className="font-sans">Source</text>
      <path d="M80 34V50" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="50" y="52" width="60" height="18" rx="4" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M80 70V86" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="80" cy="94" r="6" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="80" cy="56" r="2" fill="var(--ax-orange)" opacity="0.5" />
    </svg>
  )
}

export function EmptyConnectionVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 80" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="25" width="50" height="30" rx="5" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x="120" y="25" width="50" height="30" rx="5" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M60 40H72" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" />
      <path d="M108 40H120" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" />
      <circle cx="90" cy="40" r="8" stroke="var(--ax-orange)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />
      <text x="90" y="44" fill="var(--ax-orange)" opacity="0.5" fontSize="10" textAnchor="middle" fontWeight="700">?</text>
    </svg>
  )
}

export function EmptyEventVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 60" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 30H160" stroke="currentColor" strokeOpacity="0.08" strokeWidth="2" />
      {/* Flat pulse line */}
      <path d="M20 30H50L55 18L60 42L65 24L70 36L75 30H160" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="62" cy="30" r="3" fill="var(--ax-orange)" opacity="0.4" />
    </svg>
  )
}

export function EmptyMarketplaceVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="15" width="50" height="70" rx="6" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x="110" y="15" width="50" height="70" rx="6" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x="65" y="35" width="50" height="30" rx="5" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx="90" cy="50" r="3" fill="var(--ax-orange)" opacity="0.5" />
    </svg>
  )
}
