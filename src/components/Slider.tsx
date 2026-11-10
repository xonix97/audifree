import type { CSSProperties } from 'react'

interface SliderProps {
  value: number
  max: number
  onChange: (value: number) => void
  ariaLabel: string
  disabled?: boolean
  step?: number
  className?: string
}

/** Range input with a filled track driven by a CSS variable. */
export function Slider({
  value,
  max,
  onChange,
  ariaLabel,
  disabled = false,
  step = 0.1,
  className = '',
}: SliderProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0

  return (
    <input
      className={`slider ${className}`.trim()}
      style={{ '--fill': `${percent}%` } as CSSProperties}
      type="range"
      min={0}
      max={max > 0 ? max : 0}
      step={step}
      value={Math.min(value, max > 0 ? max : value)}
      disabled={disabled || max <= 0}
      onChange={(event) => onChange(Number(event.target.value))}
      aria-label={ariaLabel}
    />
  )
}
