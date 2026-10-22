import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      name: 'Glicemio', short_name: 'Glicemio', description: 'Acompanhamento contextual de glicemia',
      // Preserve a identidade instalada: sem id explícito, com as URLs originais.
      start_url: '/', scope: '/', display: 'standalone', lang: 'pt-BR', theme_color: '#11100f', background_color: '#11100f',
      icons: [
        { src: '/icon-192-v2.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512-v2.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/assets\//] },
  })],
})
