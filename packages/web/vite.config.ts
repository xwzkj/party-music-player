import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [
    vue({
      template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('mdui-') } },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: backend },
      '/socket.io': { target: backend, ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
