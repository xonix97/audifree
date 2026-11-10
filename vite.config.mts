import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Inject a strict CSP into the built app.  Dev needs 'unsafe-inline' because
 * Vite's React refresh preamble is an inline module; production ships the
 * locked-down version.
 */
function cspPlugin(isDev: boolean): Plugin {
  return {
    name: 'audifree-csp',
    transformIndexHtml(html) {
      const scriptSrc = isDev ? "'self' 'unsafe-inline'" : "'self'"
      const connectSrc = isDev
        ? "'self' http://127.0.0.1:* ws://localhost:*"
        : "'self' http://127.0.0.1:*"
      const csp = [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src https: blob:",
        "font-src 'self' data:",
        `connect-src ${connectSrc}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ')
      return html.replace('%CSP%', csp)
    },
  }
}

export default defineConfig(({ command }) => ({
  // Relative base so the production build works from file://
  base: './',
  plugins: [react(), cspPlugin(command === 'serve')],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    // Keep sourcemaps out of the packaged app.
    sourcemap: false,
  },
}))
