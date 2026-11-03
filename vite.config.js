import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Pure static app — no backend, no dev proxy.
// VITE_BASE lets you deploy under a sub-path (e.g. GitHub Pages: "/whohasaccess/").
export default defineConfig({
  root: 'client',
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 5173 },
  build: { outDir: '../dist', emptyOutDir: true },
})
