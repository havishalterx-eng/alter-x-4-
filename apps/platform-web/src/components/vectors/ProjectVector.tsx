export function ProjectVector({ className, stage = "build" }: { className?: string; stage?: string }) {
  // stages: plan, build, test, review, complete
  const stages = ["plan", "build", "test", "review", "complete"]
  const currentIndex = stages.indexOf(stage) !== -1 ? stages.indexOf(stage) : 1

  return (
    <svg viewBox="0 0 300 60" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 30H280" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      
      {/* Active progress line */}
      <path d={`M20 30H${20 + currentIndex * 65}`} stroke="var(--ax-orange)" strokeWidth="2" className="transition-all duration-1000" />
      
      {stages.map((s, i) => {
        const isActive = i === currentIndex
        const isPast = i < currentIndex
        const cx = 20 + i * 65

        return (
          <g key={s} className="transition-all duration-500">
            <circle 
              cx={cx} 
              cy="30" 
              r="8" 
              fill={isActive ? "var(--ax-orange)" : (isPast ? "currentColor" : "var(--ax-bg)")}
              stroke={isActive ? "var(--ax-orange)" : "currentColor"}
              strokeOpacity={isPast || isActive ? 1 : 0.2}
              strokeWidth="2"
            />
            {isActive && (
              <circle cx={cx} cy="30" r="14" stroke="var(--ax-orange)" strokeWidth="1" strokeOpacity="0.5">
                <animate attributeName="r" values="14; 20; 14" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5; 0; 0.5" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        )
      })}
    </svg>
  )
}
