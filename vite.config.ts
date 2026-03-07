import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'node:path'
import AutoImport from 'unplugin-auto-import/vite'
import { visualizer } from 'rollup-plugin-visualizer'

const base = process.env.BASE_PATH || '/'
const isPreview = process.env.IS_PREVIEW ? true : false
const isAnalyze = process.env.npm_lifecycle_event?.includes('analyze') || process.env.ANALYZE === 'true' || process.env.MODE === 'analyze'
const isProd = process.env.NODE_ENV === 'production'
// https://vite.dev/config/
export default defineConfig({
  define: {
   __BASE_PATH__: JSON.stringify(base),
   __IS_PREVIEW__: JSON.stringify(isPreview)
  },
  plugins: [
    react(),
    AutoImport({
      imports: [
        {
          'react': [
            'React',
            'useState',
            'useEffect',
            'useContext',
            'useReducer',
            'useCallback',
            'useMemo',
            'useRef',
            'useImperativeHandle',
            'useLayoutEffect',
            'useDebugValue',
            'useDeferredValue',
            'useId',
            'useInsertionEffect',
            'useSyncExternalStore',
            'useTransition',
            'startTransition',
            'lazy',
            'memo',
            'forwardRef',
            'createContext',
            'createElement',
            'cloneElement',
            'isValidElement'
          ]
        },
        {
          'react-router-dom': [
            'useNavigate',
            'useLocation',
            'useParams',
            'useSearchParams',
            'Link',
            'NavLink',
            'Navigate',
            'Outlet'
          ]
        },
        // React i18n
        {
          'react-i18next': [
            'useTranslation',
            'Trans'
          ]
        }
      ],
      dts: true,
    }),
    // Bundle analyzer in analyze mode
    ...(isAnalyze ? [visualizer({ 
      open: true, 
      filename: 'out/stats.html', 
      gzipSize: true, 
      brotliSize: true,
      template: 'treemap' // or 'sunburst', 'network', 'treemap'
    })] : [])
  ],
  base,
  build: {
    // Source map strategy: hidden for prod (for debugging without exposing), full for dev
    sourcemap: isProd ? (process.env.SOURCE_MAP === 'true' ? 'hidden' : false) : true,
    outDir: 'out',
    // Enable tree-shaking
    treeshake: {
      preset: 'recommended',
      moduleSideEffects: (id) => {
        // Keep side effects for CSS imports and specific files
        if (id.endsWith('.css')) return true
        return false
      }
    },
    rollupOptions: {
      // Externalize large dependencies if safe
      external: isProd ? [
        // Example: if using CDN for react/react-dom
        // 'react', 'react-dom'
      ] : [],
      output: {
        manualChunks: (id) => {
          // Large vendor libraries
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor';
            }
            if (id.includes('framer-motion')) {
              return 'animation';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'react-query';
            }
            if (id.includes('@supabase')) {
              return 'supabase';
            }
            if (id.includes('axios')) {
              return 'axios';
            }
            if (id.includes('react-window') || id.includes('react-virtualized')) {
              return 'virtualization';
            }
            if (id.includes('recharts')) {
              return 'charts'; // Heavy chart library, separate chunk
            }
            // Other node_modules go to vendor chunk
            return 'vendor';
          }
          
          // Admin components (lazy loaded)
          if (id.includes('/admin/')) {
            return 'admin';
          }
          
          // Player components (lazy loaded)
          if (id.includes('/player/')) {
            return 'player';
          }
        }
      }
    },
    chunkSizeWarningLimit: 500,
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: isProd,
        drop_debugger: isProd,
        pure_funcs: isProd ? ['console.log', 'console.info', 'console.debug'] : [],
        passes: 2, // Additional passes for better minification
        unsafe: false,
        unsafe_comps: false,
        unsafe_math: false,
        unsafe_proto: false,
        unsafe_regexp: false,
        unsafe_undefined: false,
        dead_code: true,
        unused: true,
        warnings: false
      },
      mangle: {
        safari10: true,
        properties: false // Don't mangle property names (safer)
      },
      format: {
        comments: false,
        preserve_annotations: false
      }
    },
    reportCompressedSize: false,
    // Optimize chunk splitting
    cssCodeSplit: true,
    // Asset inlining threshold (small assets as base64)
    assetsInlineLimit: 4096
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    open: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
    headers: {
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    }
  }
})
