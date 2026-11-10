/**
 * The liquid-glass material.
 *
 * Layers, from back to front:
 *  1. backdrop blur + saturation (Chromium-only, which is why this is Electron)
 *  2. an SVG displacement rim for edge refraction
 *  3. a specular top-edge gradient
 *  4. content
 *
 * All knobs live in CSS variables so the "Reduce glass effects" setting can
 * swap the whole material for a solid panel without touching components.
 */

import type { HTMLAttributes, ReactNode } from 'react'

export type GlassTone = 'default' | 'content' | 'bar' | 'subtle'

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  tone?: GlassTone
}

export function GlassPanel({ children, tone = 'default', className = '', ...rest }: GlassPanelProps) {
  return (
    <div className={`glass glass--${tone} ${className}`.trim()} {...rest}>
      {children}
    </div>
  )
}
