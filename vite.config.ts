import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API runs separately (npm run dev:server); send it API and photo requests.
    proxy: {
      '/api': 'http://localhost:8787',
      '/photos': 'http://localhost:8787',
    },
  },
})
