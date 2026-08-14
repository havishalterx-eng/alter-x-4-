export function KnowledgeVector({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 90" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Vertical flow lines */}
      <path d="M130 12V78" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" />

      {/* SOURCE */}
      <rect x="105" y="4" width="50" height="18" rx="4" fill="var(--ax-bg)" stroke="var(--ax-orange)" strokeWidth="1.5" />
      <text x="130" y="16" fill="var(--ax-orange)" fontSize="8" textAnchor="middle" fontWeight="700" className="font-sans">SOURCE</text>

      {/* Arrow down */}
      <path d="M130 22V30" stroke="var(--ax-orange)" strokeWidth="1.5" />
      <path d="M126 27L130 32L134 27" stroke="var(--ax-orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* DOCUMENTS */}
      <rect x="100" y="34" width="60" height="16" rx="3" fill="var(--ax-bg)" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
      <text x="130" y="45" fill="currentColor" opacity="0.7" fontSize="7" textAnchor="middle" fontWeight="600" className="font-sans">DOCUMENTS</text>

      {/* Arrow down */}
      <path d="M130 50V56" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />

      {/* CHUNKS */}
      <rect x="105" y="58" width="50" height="14" rx="3" fill="var(--ax-bg)" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
      <text x="130" y="68" fill="currentColor" opacity="0.6" fontSize="7" textAnchor="middle" fontWeight="600" className="font-sans">CHUNKS</text>

      {/* Arrow down */}
      <path d="M130 72V78" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />

      {/* RETRIEVAL */}
      <circle cx="130" cy="84" r="5" fill="var(--ax-orange)" opacity="0.8" />
    </svg>
  )
}
