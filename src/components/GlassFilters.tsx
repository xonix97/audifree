/**
 * SVG filter defs for the liquid-glass refraction rim. Rendered once at the
 * app root; the .glass::before layer references `url(#glass-refract)`.
 */

export function GlassFilters() {
  return (
    <svg className="svg-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id="glass-refract"
          x="-15%"
          y="-15%"
          width="130%"
          height="130%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.01 0.016"
            numOctaves={2}
            seed={11}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="1.6" result="soft" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="soft"
            scale={9}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
