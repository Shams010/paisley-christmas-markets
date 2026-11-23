import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      // Lets pages write `import { api } from '@/lib/api'`
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // In development, requests to /api/* are forwarded to API_PROXY:
      //   http://localhost:3000 (default) if you run the API yourself with `npm run dev` in the project root,
      //   or your live https://....vercel.app address if you only work on the frontend.
      // On Vercel the site and the API share one address, so this is not used there.
      proxy: {
        '/api': { target: env.API_PROXY || 'http://localhost:3000', changeOrigin: true, secure: true },
      },
    },
  }
})
