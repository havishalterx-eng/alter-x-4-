export function RunVector({ className, status = "running" }: { className?: string; status?: string }) {
  // abstract execution path
  return (
    <svg viewBox="0 0 300 60" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 30L60 30L90 10L140 10L170 30L210 30L240 50L280 50" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" strokeLinejoin="round" />
      
      {/* Active progress line */}
      <path d="M20 30L60 30L90 10L140 10L170 30" stroke={status === 'failed' ? "var(--ax-danger, #ef4444)" : "var(--ax-orange)"} strokeWidth="2" strokeLinejoin="round" />
      
      <circle cx="20" cy="30" r="4" fill="currentColor" opacity="0.5" />
      <circle cx="140" cy="10" r="4" fill="currentColor" opacity="0.5" />
      <circle cx="170" cy="30" r="6" fill={status === 'failed' ? "var(--ax-danger, #ef4444)" : "var(--ax-orange)"} />
      <circle cx="280" cy="50" r="4" fill="currentColor" opacity="0.2" />

      {status === 'running' && (
        <circle cx="170" cy="30" r="10" stroke="var(--ax-orange)" strokeWidth="1" strokeOpacity="0.5">
          <animate attributeName="r" values="10; 16; 10" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5; 0; 0.5" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}
