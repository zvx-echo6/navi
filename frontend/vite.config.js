import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://100.64.0.24:8420',
      '/valhalla': {
        target: 'http://100.64.0.24:8002',
        rewrite: (path) => path.replace(/^\/valhalla/, ''),
      },
      '/tiles': 'http://100.64.0.24:8420',
    },
  },
})
