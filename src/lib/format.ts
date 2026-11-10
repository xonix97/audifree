import type { ArtistRef, Track } from '../api/types'

/** "3:07" / "1:02:44" / "–" for unknown durations. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function artistNames(artists: ArtistRef[] | undefined): string {
  if (!artists || artists.length === 0) return 'Unknown artist'
  return artists.map((artist) => artist.name).join(', ')
}

export function trackSubtitle(track: Track): string {
  const artists = artistNames(track.artists)
  return track.album?.name ? `${artists} — ${track.album.name}` : artists
}
