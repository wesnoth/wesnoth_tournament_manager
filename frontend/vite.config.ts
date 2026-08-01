import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiUrl = env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  const apiOrigin = new URL(apiUrl).origin;

  return {
  plugins: [
    react(),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
      filename: 'dist/stats.html'
    })
  ],
  define: {
    'process.env.VITE_API_BASE_URL': JSON.stringify(
      apiUrl
    ),
  },
  css: {
    postcss: './postcss.config.js',
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash:8].[ext]',
        entryFileNames: 'assets/[name]-[hash:8].js',
        chunkFileNames: 'assets/[name]-[hash:8].js',
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-http': ['axios'],
          'vendor-state': ['zustand'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  };
});
