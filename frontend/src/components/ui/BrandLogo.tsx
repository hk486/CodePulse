import { Activity } from 'lucide-react'

type BrandLogoProps = {
  showText?: boolean
  showMark?: boolean
  tagline?: string
  className?: string
  markClassName?: string
  compact?: boolean
}

export function BrandLogo({
  showText = true,
  showMark = true,
  tagline,
  className = '',
  markClassName = '',
  compact = false,
}: BrandLogoProps) {
  const markSize = compact ? 'h-9 w-9 rounded-[10px]' : 'h-10 w-10 rounded-[11px]'
  const iconSize = compact ? 20 : 22
  const iconStroke = 2.75

  return (
    <span className={`codepulse-wordmark inline-flex items-center ${className}`}>
      {showMark && (
        <span
          className={`grid place-items-center shrink-0 !text-[#059669] ${markSize} ${markClassName}`}
          style={{ color: '#059669' }}
          aria-hidden="true"
        >
          <Activity size={iconSize} strokeWidth={iconStroke} color="#059669" />
        </span>
      )}
      {showText && (
        <span className={`min-w-0 overflow-hidden ${showMark ? (compact ? 'ml-2.5' : 'ml-3') : ''}`}>
          <span className={`block font-bold tracking-tight leading-none ${compact ? 'text-[18px]' : 'text-[20px]'}`}>
            <span className="code !text-[#64748B]" style={{ color: '#64748B' }}>Code</span>
            <span className="pulse !text-[#059669]" style={{ color: '#059669' }}>Pulse</span>
          </span>
          {tagline ? (
            <span className="mt-1 block text-[12px] leading-none !text-[#64748B]" style={{ color: '#64748B' }}>
              {tagline}
            </span>
          ) : null}
        </span>
      )}
    </span>
  )
}