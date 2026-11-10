interface CoverCardProps {
  title: string
  subtitle?: string
  image: string | null
  onClick: () => void
  /** Circular artwork for artists. */
  round?: boolean
}

export function CoverCard({ title, subtitle, image, onClick, round = false }: CoverCardProps) {
  return (
    <button type="button" className="cover-card" onClick={onClick}>
      <span className={`cover-card__art ${round ? 'cover-card__art--round' : ''}`}>
        {image ? (
          <img src={image} alt="" loading="lazy" />
        ) : (
          <span className="cover-card__placeholder" aria-hidden="true">
            ♪
          </span>
        )}
      </span>
      <span className="cover-card__title">{title}</span>
      {subtitle && <span className="cover-card__subtitle">{subtitle}</span>}
    </button>
  )
}
