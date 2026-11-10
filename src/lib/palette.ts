/**
 * Album-art tone extraction for the animated mesh background.
 *
 * Uses an offscreen canvas (no dependencies). YouTube's image CDN sends
 * `Access-Control-Allow-Origin: *`, so thumbnails can be read back without
 * tainting the canvas. Everything falls back to a deterministic palette derived
 * from the album id when sampling is unavailable.
 *
 * The scheme is strictly black, white and one accent, so the mesh only keeps
 * the artwork's luminance: hue and saturation are discarded and each blob gets
 * a distinct grey level. Artwork drives depth, never colour.
 */

import { useEffect, useRef, useState } from 'react'
import type { Track } from '../api/types'

export interface Palette {
  /** Changes whenever the rendered palette should crossfade. */
  key: string
  colors: [string, string, string]
  isFallback: boolean
}

const SAMPLE_SIZE = 32
const CACHE_LIMIT = 120
const cache = new Map<string, Palette>()

// -- colour helpers --------------------------------------------------------

interface Hsl {
  h: number
  s: number
  l: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const delta = max - min
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function hslToHex(hsl: Hsl): string {
  const s = clamp(hsl.s, 0, 1)
  const l = clamp(hsl.l, 0, 1)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hsl.h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hsl.h < 60) [r, g, b] = [c, x, 0]
  else if (hsl.h < 120) [r, g, b] = [x, c, 0]
  else if (hsl.h < 180) [r, g, b] = [0, c, x]
  else if (hsl.h < 240) [r, g, b] = [0, x, c]
  else if (hsl.h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toByte = (value: number) =>
    Math.round(clamp(value + m, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}

/** Deep greys read best behind blurred glass. */
function tune(hsl: Hsl): Hsl {
  return { h: 0, s: 0, l: clamp(hsl.l, 0.3, 0.58) }
}

/** Keeps the three blobs separable once hue is removed. */
const TONE_OFFSETS = [0.02, -0.06, 0.1] as const

function buildPalette(seed: string, hsles: Hsl[], isFallback: boolean): Palette {
  const colors = hsles.map((hsl, index) =>
    hslToHex({
      h: 0,
      s: 0,
      l: clamp(tune(hsl).l + (TONE_OFFSETS[index] ?? 0), 0.14, 0.62),
    }),
  )
  return {
    key: `${seed}:${isFallback ? 'fallback' : 'source'}`,
    colors: [colors[0]!, colors[1]!, colors[2]!],
    isFallback,
  }
}

export function fallbackPalette(seed: string): Palette {
  const hash = hashString(seed)
  const base = 0.3 + ((hash % 17) / 16) * 0.18
  return buildPalette(
    seed,
    [
      { h: 0, s: 0, l: base },
      { h: 0, s: 0, l: base + 0.08 },
      { h: 0, s: 0, l: base - 0.06 },
    ],
    true,
  )
}

// -- canvas sampling -------------------------------------------------------

interface Bucket {
  r: number
  g: number
  b: number
  count: number
  score: number
}

function extract(img: HTMLImageElement): Palette | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const buckets = new Map<number, Bucket>()

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0
    if (alpha < 128) continue
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const light = (max + min) / 2
    if (light < 18 || light > 242) continue

    const saturation = max === 0 ? 0 : (max - min) / max
    // Greys carry little identity but still help when artwork is monochrome.
    const weight = 0.25 + saturation * 2.4
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const existing = buckets.get(key)
    if (existing) {
      existing.r += r
      existing.g += g
      existing.b += b
      existing.count += 1
      existing.score += weight
    } else {
      buckets.set(key, { r, g, b, count: 1, score: weight })
    }
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
    }))
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) return null

  const picked: Hsl[] = []
  for (const bucket of ranked) {
    const hsl = rgbToHsl(bucket.r, bucket.g, bucket.b)
    // Hue is discarded, so separate picks by brightness rather than hue.
    if (picked.some((other) => Math.abs(other.l - hsl.l) < 0.12)) continue
    picked.push(hsl)
    if (picked.length === 3) break
  }

  // Flat artwork: derive companion grey levels from the dominant tone.
  const base = picked[0] ?? rgbToHsl(ranked[0]!.r, ranked[0]!.g, ranked[0]!.b)
  while (picked.length < 3) {
    const previous = picked[picked.length - 1] ?? base
    const step = picked.length === 1 ? 0.14 : -0.22
    picked.push({ h: 0, s: 0, l: clamp(previous.l + step, 0.08, 0.7) })
  }

  return buildPalette('art', picked, false)
}

function loadImage(url: string, timeoutMs = 8_000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const timer = window.setTimeout(() => reject(new Error('thumbnail timeout')), timeoutMs)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('thumbnail failed to load'))
    }
    img.src = url
  })
}

function remember(url: string, palette: Palette): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(url, palette)
}

async function paletteFromImage(url: string, seed: string): Promise<Palette> {
  const cached = cache.get(url)
  if (cached) return { ...cached, key: `${seed}:${cached.isFallback ? 'fallback' : 'source'}` }
  try {
    const img = await loadImage(url)
    const palette = extract(img)
    if (!palette) return fallbackPalette(seed)
    const withSeed = { ...palette, key: `${seed}:source` }
    remember(url, palette)
    return withSeed
  } catch {
    return fallbackPalette(seed)
  }
}

/**
 * Palette for the current track, refined from its artwork once the image
 * loads. The fallback is deterministic so the mesh never flashes grey.
 */
export function useAlbumPalette(track: Track | null): Palette {
  const seed = track?.album?.id ?? track?.id ?? 'audifree'
  const [palette, setPalette] = useState<Palette>(() => fallbackPalette(seed))
  const seedRef = useRef(seed)

  useEffect(() => {
    let cancelled = false
    if (seedRef.current !== seed) {
      seedRef.current = seed
      setPalette(fallbackPalette(seed))
    }

    const url = track?.thumbnail
    if (!url) return () => { cancelled = true }

    void paletteFromImage(url, seed).then((next) => {
      if (!cancelled) setPalette(next)
    })
    return () => {
      cancelled = true
    }
  }, [seed, track?.thumbnail])

  return palette
}
