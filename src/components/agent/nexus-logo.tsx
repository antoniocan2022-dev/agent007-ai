'use client'

export function NexusLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nx-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <filter id="nx-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* hexagon outline */}
      <polygon
        points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none"
        stroke="url(#nx-grad)"
        strokeWidth="2.5"
        filter="url(#nx-glow)"
        strokeLinejoin="round"
      />
      {/* inner hex */}
      <polygon
        points="32,12 49,22 49,42 32,52 15,42 15,22"
        fill="rgba(0,240,255,0.06)"
        stroke="rgba(0,240,255,0.3)"
        strokeWidth="1"
      />
      {/* N glyph */}
      <path
        d="M22 44 L22 22 L42 44 L42 22"
        fill="none"
        stroke="#00f0ff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#nx-glow)"
      />
      {/* center node */}
      <circle cx="32" cy="32" r="2" fill="#ec4899" filter="url(#nx-glow)" />
    </svg>
  )
}

export function HexAvatar({ size = 32, pulse = true }: { size?: number; pulse?: boolean }) {
  return (
    <div className={pulse ? 'hex-pulse' : ''}>
      <NexusLogo size={size} />
    </div>
  )
}
