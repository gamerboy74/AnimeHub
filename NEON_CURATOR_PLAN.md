# Neon Curator: Project Implementation Plan

This document serves as your guide to building the **Neon Curator** application using your existing Supabase database.

## 1. Project Initialization

Create a new folder `neon-curator` in your workspace and initialize a React/Vite project.

```bash
mkdir neon-curator
cd neon-curator
npm create vite@latest . -- --template react-ts
npm install @supabase/supabase-js @tanstack/react-query lucide-react framer-motion axios
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

## 2. Design System Setup

In your `neon-curator/tailwind.config.js`, add your custom Neon palette:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "primary": "#bd9dff",
        "secondary": "#00e3fd",
        "tertiary": "#ff7346",
        "background": "#0e0e11",
        "surface": "#19191d",
        "primary-dim": "#8a4cfc",
        "secondary-dim": "#00d4ec",
      },
      fontFamily: {
        "headline": ["Space Grotesk", "sans-serif"],
        "body": ["Be Vietnam Pro", "sans-serif"],
      },
    },
  },
  plugins: [],
}
```

Add the following to your `index.html` head:
- `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700&family=Be+Vietnam+Pro:wght@100;900&display=swap" rel="stylesheet">`
- `<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">`

## 3. UI Screen Inventory

Your app will consist of 6 primary screens. Copy your provided HTML code into modular React components:

| Screen | Description |
| :--- | :--- |
| **Explore** | The main landing page with bento-style genre grids. |
| **Search** | Advanced search with predictive results and category chips. |
| **Anime Detail** | Rich media header, stats, and tabbed episode lists. |
| **Video Player** | High-fidelity player with gesture controls and overlays. |
| **Library** | User-specific watchlist, history, and favorites. |
| **Admin** | Real-time dashboard with moderation queues and system logs. |

## 4. Database Integration (Supabase)

The app will connect to your existing tables:

1.  **Auth**: Use `supabase.auth` for signups/logins.
2.  **Anime Data**: Fetch posters, ratings, and descriptions from the `anime` table.
3.  **Episode Data**: Fetch lists and video links from the `episodes` table.
4.  **Watch Progress**: Save and resume playback using the `user_progress` table.
5.  **Moderation**: The Admin Dashboard will fetch and update the `reviews` and `users` tables.

## 5. API & Environment Setup

### Environment Variables (.env)
Copy these into your `neon-curator/.env` file:

```env
VITE_SUPABASE_URL=https://ieopfdxgjlmdsidikgbj.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imllb3BmZHhnamxtZHNpZGlrZ2JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1Mjg1MDgsImV4cCI6MjA3NjEwNDUwOH0.8MaTqu67m1EUnWQk1UUol2OHnFcP6k0vpcdI7EVX3aE
VITE_BACKEND_URL=http://localhost:3001
```

### Supabase Client (`src/lib/supabase.ts`)
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### Sample API Call (`src/services/anime.ts`)
```typescript
import { supabase } from '../lib/supabase'

export const getAnimeList = async (limit = 20) => {
  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .limit(limit)
  
  if (error) throw error
  return data
}
```

### 3. Folder Architecture (Feature-Based)
Organize your `src/` folder for scalability:

```text
src/
├── api/                # Supabase services (anime.ts, auth.ts)
├── components/         # Shared & UI components
│   ├── ui/             # Atomic components (Buttons, Cards, Modals)
│   └── layout/         # Shell components (Navbar, Sidebar)
├── features/           # Feature-specific logic & hooks
│   ├── player/         # Video player components & state
│   ├── library/        # Watchlist & History logic
│   └── explore/        # Genre grid and search filters
├── hooks/              # Shared hooks (useAuth, useLocalStorage)
├── pages/              # Main view entry points
└── types/              # Generated Supabase types
```

### 4. Core Libraries & Patterns

#### Routing (React Router)
Use `react-router-dom` for navigation:
- `/` -> `ExplorePage`
- `/anime/:id` -> `DetailsPage`
- `/watch/:episodeId` -> `PlayerPage`
- `/library` -> `LibraryPage` (Protected)
- `/admin` -> `AdminDashboard` (Protected/Role-based)

#### Data Fetching (TanStack Query)
Wrap your app in a `QueryClientProvider`. Use hooks like `useQuery` for all anime fetching to get automatic caching and loading states:
```typescript
const { data: anime, isLoading } = useQuery({
  queryKey: ['anime', id],
  queryFn: () => getAnimeById(id)
})
```

#### Authentication Context
Create an `AuthProvider` that listens to `supabase.auth.onAuthStateChange` to track the logged-in user globally.

### 5. Professional Infrastructure (Parity Audit)
To match the high standards of your existing webapp, we must include these "Expert-Level" systems:

- **I18n (Internationalization)**: Use `i18next` as seen in your current `src/i18n/index.ts`. This allows you to support global users with multiple languages.
- **PWA / Service Workers**: Include the `serviceWorkerManager` from your project. This ensures the app is "Installable" and works offline/on slow connections.
- **Global Error Boundary**: Implement the `ErrorBoundary` from `src/components/common/ErrorBoundary.tsx` to prevent the whole app from crashing if one component fails.
- **Performance Monitoring**: Set up the `PerformanceMonitor` and `errorTracking` logic to catch bugs in production before users report them.
- **Extension Filtering**: Use the `shouldIgnoreError` logic from your `main.tsx` to prevent browser extensions (like AdBlockers) from triggering false-positive errors.

## 6. Backend & Scraper Engine (The "Heart")

To match the full functionality of your existing webapp, Neon Curator needs the **Backend Engine** for automated content updates:

### Scraper Service (`/backend/scrapers`)
Port your `playwright-extra` scrapers to a dedicated Node.js service.
- **Source**: `hianime.do`, `9anime`, etc.
- **Task**: Automatically update the `episodes` and `anime` tables.
- **Workflow**: Scrape -> Extract Video URL -> Store in Supabase -> Notify Users.

### Scheduler & Task Queue
Maintain your scheduler (seen in your `.env`) to run:
- **Episode Check**: Every 6 hours.
- **New Anime Sync**: Every 24 hours.
- **Rate Limiting**: To avoid being blocked by anime sources.

### Redis Caching
For high-traffic sections like "Featured" and "Trending", use Redis (connected via `VITE_BACKEND_URL`) to avoid hitting Supabase row limits and ensuring 100ms response times for the Neon UI.

## 8. Is this enough for a full app?

**Yes, with the Backend Engine included.** 
Without the scrapers, the app would be "read-only" (users can't see new episodes unless you add them manually). With the Backend Engine, it becomes a fully automated platform like your current webapp.

## 9. Final Implementation Checklist

1. [x] Identify API and Env requirements.
2. [x] Identify Scraper and Backend Engine requirements.
3. [ ] Initialize Vite project and install `react-router-dom` + `@tanstack/react-query`.
4. [ ] Set up the `neon-curator-backend` (Node.js) to host your scrapers and scheduler.
5. [ ] Copy your HTML code into the `features/` directory as React components.
6. [ ] Set up the `AuthProvider` to link with your existing Supabase users.
7. [ ] Connect the "Explore" screen to the `RPC search_anime_optimized` for neon-fast results.



ui html code
<!-- Design System -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Explore - NEON CURATOR</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&amp;family=Be+Vietnam+Pro:wght@100;300;400;500;700;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "on-primary": "#3c0089",
              "on-tertiary-fixed-variant": "#6e1c00",
              "primary-dim": "#8a4cfc",
              "tertiary-dim": "#ff7346",
              "on-error-container": "#ffb2b9",
              "secondary-fixed": "#26e6ff",
              "surface-container-high": "#1f1f23",
              "on-surface": "#f0edf1",
              "surface-container-low": "#131316",
              "error-container": "#a70138",
              "error": "#ff6e84",
              "primary-container": "#b28cff",
              "tertiary-fixed": "#ff9473",
              "on-secondary-container": "#e8fbff",
              "on-primary-fixed": "#000000",
              "secondary-container": "#006875",
              "background": "#0e0e11",
              "outline": "#767579",
              "secondary-fixed-dim": "#00d7f0",
              "inverse-on-surface": "#555458",
              "primary": "#bd9dff",
              "tertiary-container": "#fc4c00",
              "on-secondary": "#004d57",
              "inverse-surface": "#fcf8fd",
              "on-error": "#490013",
              "surface": "#0e0e11",
              "surface-container-highest": "#25252a",
              "surface-container-lowest": "#000000",
              "surface-variant": "#25252a",
              "error-dim": "#d73357",
              "secondary-dim": "#00d4ec",
              "tertiary": "#ff7346",
              "on-tertiary-container": "#0e0100",
              "outline-variant": "#48474b",
              "on-tertiary-fixed": "#340800",
              "on-primary-container": "#2e006c",
              "surface-tint": "#bd9dff",
              "secondary": "#00e3fd",
              "surface-bright": "#2c2c30",
              "on-background": "#f0edf1",
              "primary-fixed-dim": "#a67aff",
              "on-secondary-fixed": "#003a42",
              "on-secondary-fixed-variant": "#005964",
              "on-tertiary": "#420d00",
              "surface-dim": "#0e0e11",
              "primary-fixed": "#b28cff",
              "tertiary-fixed-dim": "#ff7d54",
              "inverse-primary": "#742fe5",
              "surface-container": "#19191d",
              "on-primary-fixed-variant": "#390083",
              "on-surface-variant": "#acaaae"
            },
            fontFamily: {
              "headline": ["Space Grotesk"],
              "body": ["Be Vietnam Pro"],
              "label": ["Be Vietnam Pro"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        .glass-panel {
            background: rgba(25, 25, 29, 0.6);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
        }
        .text-glow-primary {
            text-shadow: 0 0 15px rgba(189, 157, 255, 0.4);
        }
        .no-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary/30 min-h-screen pb-24">
<!-- TopAppBar -->
<header class="fixed top-0 left-0 w-full flex justify-between items-center px-6 py-4 bg-[#0e0e11]/60 backdrop-blur-xl z-50 bg-gradient-to-b from-[#131316] to-transparent shadow-[0_4px_30px_rgba(189,157,255,0.08)]">
<div class="flex items-center gap-3">
<div class="w-10 h-10 rounded-full overflow-hidden border border-primary/20 bg-surface-container">
<img alt="User Profile" class="w-full h-full object-cover" data-alt="close up portrait of a young woman with a futuristic neon aesthetic and violet lighting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA17_3upRW7ua89O2yAycLPdNc6NyjWhaCH0Pf8b1_kdMthqtWbPdmAjAIRVM2mTonVhAHA-urFyT97yN3y_bzW5o9Voh-2HcySkI2rYmzPwhBLxoOnQ9aOX7HsEVLMud4B0lQDYGTJOTQyn360K5XahwHcHIkNFofp3eVv9ny1nwye6TfLbjfyXRbPYEFppdtm9g6_Lg1d-iisZmys2f0tk8A-573Q6_VhpXVJTK5mZZKDTna47Vzaq7gnND-xbFyFaY0S9km-bu55"/>
</div>
<h1 class="text-xl font-black tracking-tighter text-[#bd9dff] uppercase font-['Space_Grotesk']">NEON CURATOR</h1>
</div>
<button class="text-[#bd9dff] hover:text-[#00e3fd] transition-colors duration-300">
<span class="material-symbols-outlined" data-icon="search">search</span>
</button>
</header>
<main class="pt-24 px-6 max-w-7xl mx-auto">
<!-- Persistent Search Bar -->
<section class="mb-8">
<div class="relative group">
<div class="absolute inset-y-0 left-4 flex items-center pointer-events-none">
<span class="material-symbols-outlined text-outline group-focus-within:text-secondary transition-colors" data-icon="search">search</span>
</div>
<input class="w-full bg-surface-container-high border-none rounded-xl py-5 pl-12 pr-4 text-on-surface placeholder:text-on-surface-variant focus:ring-2 focus:ring-primary/40 transition-all shadow-lg font-medium" placeholder="Search titles, studios, or genres..." type="text"/>
<div class="absolute inset-y-0 right-4 flex items-center">
<span class="material-symbols-outlined text-outline cursor-pointer hover:text-secondary" data-icon="tune">tune</span>
</div>
</div>
<!-- Trending Chips -->
<div class="flex gap-3 mt-4 overflow-x-auto no-scrollbar pb-2">
<span class="px-4 py-2 bg-primary/10 border border-primary/20 text-primary rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap">
<span class="material-symbols-outlined text-[14px]" data-icon="trending_up">trending_up</span>
                    Chainsaw Man
                </span>
<span class="px-4 py-2 bg-surface-container-highest text-on-surface-variant rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap hover:bg-surface-bright transition-colors">Spy x Family</span>
<span class="px-4 py-2 bg-surface-container-highest text-on-surface-variant rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap hover:bg-surface-bright transition-colors">Bleach: TYBW</span>
<span class="px-4 py-2 bg-surface-container-highest text-on-surface-variant rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap hover:bg-surface-bright transition-colors">Mob Psycho 100</span>
<span class="px-4 py-2 bg-surface-container-highest text-on-surface-variant rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap hover:bg-surface-bright transition-colors">Cyberpunk</span>
</div>
</section>
<!-- Bento Genre Grid -->
<section class="mb-12">
<div class="flex justify-between items-end mb-6">
<h2 class="font-headline text-2xl font-bold tracking-tight text-on-surface">Browse by Genre</h2>
<span class="text-sm font-bold text-secondary uppercase tracking-widest cursor-pointer hover:underline">See All</span>
</div>
<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
<!-- Action -->
<div class="relative h-40 rounded-2xl overflow-hidden group cursor-pointer col-span-1 md:col-span-2 shadow-2xl transition-transform hover:scale-[1.02]">
<img class="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" data-alt="vibrant abstract background with explosive streaks of orange and deep purple light suggesting high octane action" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAdSEJ2de24c7ssGjUsZI5yBYnY2igFOjOuG5JDAwDk5szL0ryUyqnbhVikkWuVkWnqzcXV2EayVLNK48tk6FTRFkVxXm5q880Czz69vl0ur4zF-sq3RKX3b47Lxl3QzuA5pWWOUlK3Ax63CvSVfGxsBaASYTzfAvvdUvLC_gMBSSTAVrXwvB72Rkh7SHfxJ5N98HvMi2fkgUDc7_fBdxPs5zokM2pslr9dYKJNiSJ94DIDpVa5SaQyqmp60ZVmbpRzoD4QF0Dk7nn5"/>
<div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
<div class="absolute bottom-4 left-4">
<p class="text-tertiary font-headline font-bold text-lg tracking-wide uppercase">Action</p>
<p class="text-on-surface-variant text-xs font-medium">Adrenaline-fueled epic battles</p>
</div>
</div>
<!-- Cyberpunk/Sci-Fi -->
<div class="relative h-40 rounded-2xl overflow-hidden group cursor-pointer shadow-2xl transition-transform hover:scale-[1.02]">
<img class="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all" data-alt="futuristic neon cityscape with cyan and magenta glowing lights and high tech architecture" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBaTBuR0ffSEyUUrhktF8PGYGrsyrHZxy_gUJKk1jPpSTdLkbNugDdL3rutPSbe3VFxbBqe30hBCvMV_hGaUetR4S2lFZcGqOTH2rYRlym6VECxl2Zfa0BFxnIoq0bPZzxWYNAEJNqm6wZh__B9DWkF7e3M4Wwfo0-8GbXI8M5Is9wVcIeDd6Za2oMIqF2oSgxmjeyx6H9TlS5oGZGo6XJ10QyDP9Ppk7aq0dD9kTgunxuOyWMdvYBZzYubOMSKJLY1J9mBRQZFogfe"/>
<div class="absolute inset-0 bg-secondary/20 mix-blend-overlay"></div>
<div class="absolute bottom-4 left-4">
<p class="text-secondary font-headline font-bold text-lg tracking-wide uppercase">Sci-Fi</p>
</div>
</div>
<!-- Fantasy -->
<div class="relative h-40 rounded-2xl overflow-hidden group cursor-pointer shadow-2xl transition-transform hover:scale-[1.02]">
<img class="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all" data-alt="enchanted forest at night with glowing blue mushrooms and mystical floating particles" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAmmtJjtmOrzWiR4q84ttR155Yr3AWHbj7WZK_OrhkN_lwcQD6d-nMmQ12k6SMDjg5aBWMGeqMHoqRZLC2mJQ60uIQoaUWk8cbamNCuK_oHGfu6QhXwe_TVLWznl7CSVDmwGXjM2b-DTNjnkn9qx83FmrY7Ux0b4BmSYKsW0cwcToqn09iV_HuOgMPDXUZTpUVftr5p0ZK3cFLNmIRrf6n6Puy8endKdksffUm0oGtEFUbioQufBBHpZT9cgWVhYOY6eqijaV_OcDcu"/>
<div class="absolute inset-0 bg-primary/20 mix-blend-overlay"></div>
<div class="absolute bottom-4 left-4">
<p class="text-primary font-headline font-bold text-lg tracking-wide uppercase">Fantasy</p>
</div>
</div>
<!-- Shonen -->
<div class="relative h-40 rounded-2xl overflow-hidden group cursor-pointer shadow-2xl transition-transform hover:scale-[1.02]">
<img class="absolute inset-0 w-full h-full object-cover grayscale brightness-50 group-hover:grayscale-0 group-hover:brightness-100 transition-all" data-alt="dramatic silhouette of a hero character standing against a fierce sunset sky" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCF1HXWWmpd__QNjZXg-0vL0-SRlYDTDQaWRXADPZyHUxBHreNrv-AshjBQnQZpFloP_Q3W4jfVBshX6Qiil-SJZrniWrFCEgYv4JtGIEhO-tKv0Y63oFZd-o_2YZTnDG3WdG-RXd0Xzgc0V4QaepaNLfEygs2ADGigH1ffG70p2IhbTK1MPN6kL26gijblQ2DHC38FJC_qowYlZ-R7DedYIhp2N23QR5BXE3HOiU-iLYMrEtRqswJZ0o1N193R7Z45D6Eps2PB9x-Q"/>
<div class="absolute bottom-4 left-4">
<p class="text-on-surface font-headline font-bold text-lg tracking-wide uppercase">Shonen</p>
</div>
</div>
<!-- Romance -->
<div class="relative h-40 rounded-2xl overflow-hidden group cursor-pointer col-span-1 md:col-span-3 shadow-2xl transition-transform hover:scale-[1.02]">
<img class="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-80 transition-all" data-alt="delicate cherry blossom petals falling over a serene river during twilight with soft pink and lavender hues" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDXxuUCuBWsCv2xuGSbZ6x0V7y7CbIc17X9dt6CeSYD-nV1XIapGLd33yzAYxjyLVsSyNEAdY_mBY73ZaHnqrBdeNeh39ufyfevnxDmCcXQRz0MKp3ma9FfEJuSqHFo-ToI1J9MoYAnSGxr3RGLMt5J53tbY4ywM4ZBkbRCv8eGwIAcB1aN0dWBrxq529vjNFAn76FiJ0_Tbg1zHXLvPljRiswN61pj3XUWbDDmHBFLMLkuVnEgosQj9MThAVCDQS3OgbGBasd2adjJ"/>
<div class="absolute inset-0 bg-gradient-to-r from-background to-transparent"></div>
<div class="absolute bottom-4 left-4">
<p class="text-on-primary-container bg-primary-container px-3 py-1 rounded-lg inline-block font-headline font-bold text-lg tracking-wide uppercase mb-1">Romance</p>
<p class="text-on-surface text-sm opacity-80">Heartfelt stories &amp; emotional journeys</p>
</div>
</div>
</div>
</section>
<!-- Search Results / Featured -->
<section class="mb-12">
<h2 class="font-headline text-2xl font-bold tracking-tight text-on-surface mb-6">Popular Recommendations</h2>
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
<!-- Result 1 -->
<div class="group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-primary/20">
<img class="w-full h-full object-cover" data-alt="anime style illustration of a high-tech warrior with glowing blue armor in a dark industrial setting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCywXCIl18g-tjjTWGDGHXteTr0L0JqhQFIIvBDrqLsOoIghvGwJBFCrQNXysdCZnvwp4_n_jQ6Lf8uVSO97qr_rI4nG4fgWRZ3ka4wwU0nEi_6KXhBIk3mgmw9sKj65j8yXkUkaNRY6m8VNQOy-eWBhEdFQH7gVZCd6Z_I1l-a2jc9jrXNUp0pbT4HwdIp4pajZlzve-i5PEoQuiC8NtNVOAsnUoMAd_2RRur3s5tWDp7Sc-O0Tq-APnHQ3AHKbif-fHKKOKlto-_2"/>
<div class="absolute top-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-md px-2 py-1 rounded-lg border border-outline-variant/30">
<span class="material-symbols-outlined text-secondary text-xs" data-icon="star" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[10px] font-bold text-on-surface">9.2</span>
</div>
<div class="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
<div class="h-full bg-secondary w-3/4 shadow-[0_0_8px_rgba(0,227,253,0.6)]"></div>
</div>
</div>
<h3 class="font-bold text-on-surface text-sm line-clamp-1 group-hover:text-primary transition-colors">VANGUARD: PROTOCOL 0</h3>
<p class="text-xs text-on-surface-variant mt-1 font-medium">MAPPA • 24 Episodes</p>
</div>
<!-- Result 2 -->
<div class="group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-primary/20">
<img class="w-full h-full object-cover" data-alt="stylized illustration of a lone samurai under a massive red moon with falling autumn leaves" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAH69cUy3_SiK6XQlQq8nZ5NobdIzeKYklicYPvJeoDgp8pFiGuqQp1PaR6iMqMpJKPxR9SGNbcYt2G5p-tAw-YfVHGMJYNZMajLxbA8sm2VlVhcMFmKxhBHoOOrOLK_-fg2i8bfgOml77IXzN5_V6LsBHQ3jASF_Ah5fsmdPwg3THVqyGGTUqVAeOiO7lY5sf7oYklpUH7LYLHW507DnLbyuXbIENamcQNwe3EzEzdNaGNLIdKFBzUVlwlLvQGLqICc_HUp05F0i9i"/>
<div class="absolute top-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-md px-2 py-1 rounded-lg border border-outline-variant/30">
<span class="material-symbols-outlined text-secondary text-xs" data-icon="star" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[10px] font-bold text-on-surface">8.8</span>
</div>
</div>
<h3 class="font-bold text-on-surface text-sm line-clamp-1 group-hover:text-primary transition-colors">RONIN OF THE RED MOON</h3>
<p class="text-xs text-on-surface-variant mt-1 font-medium">Ufotable • Ongoing</p>
</div>
<!-- Result 3 -->
<div class="group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-primary/20">
<img class="w-full h-full object-cover" data-alt="dramatic scene with a high speed chase through a neon lit tunnel with streaks of light" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD6QnGWwWd-SQgGZfIQVx2NzEJrbBHd3wkW7A0cOpD3Mzo_euoHAw9ziwoo8SSAJWH4u3lhFb9IRLKjqb1xPZ9VC7DVpdWDd7Q6QW8xWthmys4cbIgRVFkpF5cnId4jh3nuRQVM9y87X19PyXEA8XelmIeQZxhe6kq4LRElRP1uwPANPRud2mnDqWOv6HD4tM3cpWWeHqhzirGUFj9z6U_00DOxopAP_ZfZzWRph0xaXBIn5NpiH16En41m02Vn4qhqWf4z6icaXKk5"/>
<div class="absolute top-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-md px-2 py-1 rounded-lg border border-outline-variant/30">
<span class="material-symbols-outlined text-secondary text-xs" data-icon="star" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[10px] font-bold text-on-surface">9.5</span>
</div>
</div>
<h3 class="font-bold text-on-surface text-sm line-clamp-1 group-hover:text-primary transition-colors">NEON VELOCITY</h3>
<p class="text-xs text-on-surface-variant mt-1 font-medium">Trigger • 12 Episodes</p>
</div>
<!-- Result 4 -->
<div class="group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-primary/20">
<img class="w-full h-full object-cover" data-alt="peaceful landscape of a floating island with ancient ruins and lush greenery under a vast blue sky" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCr7J5xHrdhOxz3FnUH9AwleJgqdH7X8HHZ5sjLhwYuiblmjHnsD4E62VUyf3rif_AbxhiAH9z4ZR22tWDyEccI-vhNCbx2-Hg9eEBWWfEyIViQU9w7gputf6vthD4MvI9CRGotOctoydLtVD6tScZZQfyThb3HwxOqK3ztetuZ9saRcbYO_jRQGODGUeAOx50pr6JlzDae6vbXDcrVhh-5qPeNL0saHtcd14jg5-EYTA7Wdh-jX3RizgbXY9KT5AcmovILT9AvdxkV"/>
<div class="absolute top-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-md px-2 py-1 rounded-lg border border-outline-variant/30">
<span class="material-symbols-outlined text-secondary text-xs" data-icon="star" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[10px] font-bold text-on-surface">8.4</span>
</div>
</div>
<h3 class="font-bold text-on-surface text-sm line-clamp-1 group-hover:text-primary transition-colors">ETHEREAL HORIZONS</h3>
<p class="text-xs text-on-surface-variant mt-1 font-medium">Wit Studio • 26 Episodes</p>
</div>
</div>
</section>
<!-- Top Studios -->
<section class="mb-20">
<h2 class="font-headline text-2xl font-bold tracking-tight text-on-surface mb-6">Top Studios</h2>
<div class="flex gap-4 overflow-x-auto no-scrollbar py-4">
<div class="flex-none w-36 aspect-square glass-panel rounded-2xl flex flex-col items-center justify-center border border-outline-variant/20 hover:border-primary/50 transition-all cursor-pointer">
<div class="w-16 h-16 bg-surface-container-highest rounded-full flex items-center justify-center mb-3">
<span class="font-headline font-black text-primary text-xl">M</span>
</div>
<span class="text-xs font-bold uppercase tracking-widest text-on-surface">MAPPA</span>
</div>
<div class="flex-none w-36 aspect-square glass-panel rounded-2xl flex flex-col items-center justify-center border border-outline-variant/20 hover:border-primary/50 transition-all cursor-pointer">
<div class="w-16 h-16 bg-surface-container-highest rounded-full flex items-center justify-center mb-3">
<span class="font-headline font-black text-secondary text-xl">U</span>
</div>
<span class="text-xs font-bold uppercase tracking-widest text-on-surface">Ufotable</span>
</div>
<div class="flex-none w-36 aspect-square glass-panel rounded-2xl flex flex-col items-center justify-center border border-outline-variant/20 hover:border-primary/50 transition-all cursor-pointer">
<div class="w-16 h-16 bg-surface-container-highest rounded-full flex items-center justify-center mb-3">
<span class="font-headline font-black text-tertiary text-xl">T</span>
</div>
<span class="text-xs font-bold uppercase tracking-widest text-on-surface">Trigger</span>
</div>
<div class="flex-none w-36 aspect-square glass-panel rounded-2xl flex flex-col items-center justify-center border border-outline-variant/20 hover:border-primary/50 transition-all cursor-pointer">
<div class="w-16 h-16 bg-surface-container-highest rounded-full flex items-center justify-center mb-3">
<span class="font-headline font-black text-on-surface text-xl">W</span>
</div>
<span class="text-xs font-bold uppercase tracking-widest text-on-surface">Wit Studio</span>
</div>
<div class="flex-none w-36 aspect-square glass-panel rounded-2xl flex flex-col items-center justify-center border border-outline-variant/20 hover:border-primary/50 transition-all cursor-pointer">
<div class="w-16 h-16 bg-surface-container-highest rounded-full flex items-center justify-center mb-3">
<span class="font-headline font-black text-primary-dim text-xl">B</span>
</div>
<span class="text-xs font-bold uppercase tracking-widest text-on-surface">Bones</span>
</div>
</div>
</section>
</main>
<!-- BottomNavBar -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-3 bg-[#131316]/60 backdrop-blur-2xl z-50 rounded-t-2xl border-t border-[#bd9dff]/15 shadow-[0_-10px_40px_rgba(189,157,255,0.05)] md:hidden">
<div class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all cursor-pointer active:scale-90 duration-150">
<span class="material-symbols-outlined" data-icon="home">home</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Home</span>
</div>
<div class="flex flex-col items-center justify-center text-[#bd9dff] bg-[#bd9dff]/10 rounded-xl px-4 py-1 shadow-[0_0_15px_rgba(189,157,255,0.2)] active:scale-90 duration-150">
<span class="material-symbols-outlined" data-icon="explore">explore</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Explore</span>
</div>
<div class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all cursor-pointer active:scale-90 duration-150">
<span class="material-symbols-outlined" data-icon="subscriptions">subscriptions</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Library</span>
</div>
<div class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all cursor-pointer active:scale-90 duration-150">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Admin</span>
</div>
</nav>
<!-- Desktop Navigation Side Anchors (Mental Map) -->
<div class="hidden md:flex fixed right-8 top-1/2 -translate-y-1/2 flex-col gap-8 z-50">
<div class="w-1 h-24 bg-surface-container-highest rounded-full relative">
<div class="absolute top-1/4 h-1/3 w-full bg-primary rounded-full shadow-[0_0_10px_#bd9dff]"></div>
</div>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-[0.3em] vertical-text transform rotate-90 origin-center whitespace-nowrap">Explore Mode</p>
</div>
</body></html>

<!-- Search & Explore -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>NEON CURATOR | Anime Streaming</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&amp;family=Be+Vietnam+Pro:wght@300;400;500;600;700;800&amp;family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "on-primary": "#3c0089",
              "on-tertiary-fixed-variant": "#6e1c00",
              "primary-dim": "#8a4cfc",
              "tertiary-dim": "#ff7346",
              "on-error-container": "#ffb2b9",
              "secondary-fixed": "#26e6ff",
              "surface-container-high": "#1f1f23",
              "on-surface": "#f0edf1",
              "surface-container-low": "#131316",
              "error-container": "#a70138",
              "error": "#ff6e84",
              "primary-container": "#b28cff",
              "tertiary-fixed": "#ff9473",
              "on-secondary-container": "#e8fbff",
              "on-primary-fixed": "#000000",
              "secondary-container": "#006875",
              "background": "#0e0e11",
              "outline": "#767579",
              "secondary-fixed-dim": "#00d7f0",
              "inverse-on-surface": "#555458",
              "primary": "#bd9dff",
              "tertiary-container": "#fc4c00",
              "on-secondary": "#004d57",
              "inverse-surface": "#fcf8fd",
              "on-error": "#490013",
              "surface": "#0e0e11",
              "surface-container-highest": "#25252a",
              "surface-container-lowest": "#000000",
              "surface-variant": "#25252a",
              "error-dim": "#d73357",
              "secondary-dim": "#00d4ec",
              "tertiary": "#ff7346",
              "on-tertiary-container": "#0e0100",
              "outline-variant": "#48474b",
              "on-tertiary-fixed": "#340800",
              "on-primary-container": "#2e006c",
              "surface-tint": "#bd9dff",
              "secondary": "#00e3fd",
              "surface-bright": "#2c2c30",
              "on-background": "#f0edf1",
              "primary-fixed-dim": "#a67aff",
              "on-secondary-fixed": "#003a42",
              "on-secondary-fixed-variant": "#005964",
              "on-tertiary": "#420d00",
              "surface-dim": "#0e0e11",
              "primary-fixed": "#b28cff",
              "tertiary-fixed-dim": "#ff7d54",
              "inverse-primary": "#742fe5",
              "surface-container": "#19191d",
              "on-primary-fixed-variant": "#390083",
              "on-surface-variant": "#acaaae"
            },
            fontFamily: {
              "headline": ["Space Grotesk"],
              "body": ["Be Vietnam Pro"],
              "label": ["Be Vietnam Pro"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
            display: inline-block;
            line-height: 1;
            text-transform: none;
            letter-spacing: normal;
            word-wrap: normal;
            white-space: nowrap;
            direction: ltr;
        }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .glass-panel {
            background: rgba(25, 25, 29, 0.6);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
        }

        .hero-gradient {
            background: linear-gradient(0deg, #0e0e11 0%, rgba(14, 14, 17, 0.8) 40%, transparent 100%);
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary/30 min-h-screen pb-24 md:pb-0">
<!-- Top Navigation Shell -->
<header class="fixed top-0 left-0 w-full flex justify-between items-center px-6 py-4 bg-[#0e0e11]/60 backdrop-blur-xl z-50 shadow-[0_4px_30px_rgba(189,157,255,0.08)] bg-gradient-to-b from-[#131316] to-transparent">
<div class="flex items-center gap-4">
<div class="w-10 h-10 rounded-full overflow-hidden border-2 border-primary/20">
<img alt="User Profile Avatar" class="w-full h-full object-cover" data-alt="portrait of a stylized digital avatar with soft neon highlights and a clean modern aesthetic" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDDi-cKovYI_nvVZsN_VD84DcYbJCg8EHgPpxMEn201uNo_zzBFi_QSkgsiH9zTpOVd22NMCNIQRbo2JZXdG2dSqjDW2rZJPLhvwZnv65CHBmFk-88HSRRQouDGsowQCXBHMWhuCVGnosdFsxUow12UGqOZHq4OcWTsEihuoQy3upqAY0TR5F8u7PysITfd28n02qYffgfItZrQrObX718uJceAxmTmuouRbFMSdsRtMP-7AAcpy9629XngXW5XVb3RwKqmcQ_IiuqG"/>
</div>
<h1 class="text-xl font-black tracking-tighter text-[#bd9dff] uppercase font-['Space_Grotesk']">NEON CURATOR</h1>
</div>
<!-- Desktop Nav Links (Hidden on Mobile) -->
<nav class="hidden md:flex items-center gap-8 font-label text-sm font-bold tracking-widest uppercase">
<a class="text-[#bd9dff] hover:text-[#00e3fd] transition-colors duration-300" href="#">Home</a>
<a class="text-[#acaaae] hover:text-[#00e3fd] transition-colors duration-300" href="#">Explore</a>
<a class="text-[#acaaae] hover:text-[#00e3fd] transition-colors duration-300" href="#">Library</a>
<a class="text-[#acaaae] hover:text-[#00e3fd] transition-colors duration-300" href="#">Admin</a>
</nav>
<button class="text-[#bd9dff] hover:text-[#00e3fd] transition-colors duration-300 active:scale-95 duration-200">
<span class="material-symbols-outlined" data-icon="search">search</span>
</button>
</header>
<main class="relative">
<!-- Hero Section -->
<section class="relative h-[751px] md:h-[795px] w-full overflow-hidden">
<div class="absolute inset-0 z-0">
<img alt="Featured Anime Art" class="w-full h-full object-cover scale-105" data-alt="cinematic digital painting of a futuristic neo-tokyo cityscape at night with vibrant purple and cyan neon lights reflecting on wet streets" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBb4UmZbJvNMTs6Qiu6J0uBG8cXwTqH8jAhYDIhNP32goAnE6tcTtPBMna1KEPcZwNTX9Z_91d974G1wwtkwOcwBEMIg5zLQsmJ-XXmlR9dP1MkXmmja1UDSwaq-iSUI0CLS7U4qwogkg9cVWC7qViGIMjgeFXpVx6AYcx_dMickYP9UU4UkTDgxMGp7PrznXwvX0xo0eJXkpDeEhr2YInU_wxkYzJCmVq0cdq3vBct23tCleUb7vD40R1NkRDpLguN12RYzScS9qKw"/>
<div class="absolute inset-0 hero-gradient"></div>
</div>
<div class="relative z-10 h-full flex flex-col justify-end px-6 md:px-16 pb-20 md:pb-32 max-w-7xl mx-auto">
<div class="mb-4">
<span class="inline-block bg-tertiary-container text-on-tertiary-container px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-tighter mb-4">Seasonal Exclusive</span>
<h2 class="font-headline text-5xl md:text-8xl font-bold leading-none tracking-tighter mb-4 text-on-surface">
                        CYBER<br/><span class="text-primary">VALKYRIE</span>
</h2>
<p class="text-on-surface-variant max-w-xl text-sm md:text-lg leading-relaxed mb-8 line-clamp-3 md:line-clamp-none">
                        In a world where memories can be digitized, one renegade pilot uncovers a conspiracy that spans the entire galaxy. Experience the visual masterpiece of the decade.
                    </p>
</div>
<div class="flex flex-wrap items-center gap-4">
<button class="bg-gradient-to-r from-primary to-primary-dim text-on-primary-container font-label font-bold text-sm px-8 py-4 rounded-full flex items-center gap-2 hover:shadow-[0_0_20px_rgba(189,157,255,0.4)] transition-all active:scale-95">
<span class="material-symbols-outlined fill" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
                        WATCH NOW
                    </button>
<button class="glass-panel border border-outline-variant/20 text-on-surface font-label font-bold text-sm px-8 py-4 rounded-full flex items-center gap-2 hover:bg-surface-bright transition-all active:scale-95">
<span class="material-symbols-outlined">add</span>
                        MY LIST
                    </button>
</div>
</div>
</section>
<!-- Genre Filtering Chips -->
<div class="sticky top-[72px] z-40 px-6 py-4 bg-background/80 backdrop-blur-md">
<div class="flex items-center gap-3 overflow-x-auto hide-scrollbar">
<button class="whitespace-nowrap bg-primary-container text-on-primary-container px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest">All Genre</button>
<button class="whitespace-nowrap bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:text-on-surface transition-colors">Cyberpunk</button>
<button class="whitespace-nowrap bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:text-on-surface transition-colors">Fantasy</button>
<button class="whitespace-nowrap bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:text-on-surface transition-colors">Seinen</button>
<button class="whitespace-nowrap bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:text-on-surface transition-colors">Slice of Life</button>
<button class="whitespace-nowrap bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:text-on-surface transition-colors">Mecha</button>
<button class="whitespace-nowrap bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:text-on-surface transition-colors">Psychological</button>
</div>
</div>
<!-- Content Sections -->
<div class="space-y-12 py-12">
<!-- Trending Now -->
<section class="pl-6 md:pl-16">
<div class="flex items-center justify-between pr-6 md:pr-16 mb-6">
<h3 class="font-headline text-2xl font-bold tracking-tight">Trending <span class="text-secondary">Now</span></h3>
<a class="text-on-surface-variant text-xs font-bold uppercase tracking-widest hover:text-secondary transition-colors" href="#">See All</a>
</div>
<div class="flex gap-4 overflow-x-auto hide-scrollbar pb-4 pr-6 md:pr-16">
<!-- Card 1 -->
<div class="flex-none w-40 md:w-56 group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 bg-surface-container shadow-xl transition-transform duration-300 group-hover:scale-105 group-hover:shadow-primary/10">
<img alt="Anime Poster" class="w-full h-full object-cover" data-alt="dramatic close-up of a samurai character with glowing eyes against a backdrop of falling cherry blossom petals" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAXLDetnUNGJUOIfSegb0eKJBVFqZdtLaDxvkALeaE2THpvMt1SHW3r9f2IwHUGFlPu40aNoMsmFMXcxr1tSLK8WXeuGndPN31YZJPuQ4rPJXSYrwZfw8OG1e6k5QmdeVCw1h243DkbLMdznIODeH4mAPOBV994k-Jpn8n4_7NqRlGAyg8F7IjfrGWiwBYascqVTDXO4nkSF6e6-4csANn7RgBrGzVCdqonceo4m6K_85KoeUGaGnyb9eMPQ6aZ7jGDZUX4J_zJ3FLf"/>
<div class="absolute top-2 right-2 glass-panel px-2 py-1 rounded-md text-[10px] font-bold text-secondary-fixed">EP 12</div>
</div>
<h4 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Shadow of Edo</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">Action • Historical</p>
</div>
<!-- Card 2 -->
<div class="flex-none w-40 md:w-56 group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 bg-surface-container shadow-xl transition-transform duration-300 group-hover:scale-105 group-hover:shadow-primary/10">
<img alt="Anime Poster" class="w-full h-full object-cover" data-alt="artistic portrait of a magical girl silhouette surrounded by ethereal blue flames and geometric arcane symbols" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDjozMmBUJ7oAu7kNxz8GAvcolbb3AnCMQTsHJNJwIuHzlUnpn2vGRd0OFRRhuNOsvVRfTaXF3K0-X13DjpGZyVLeiTgAWsN8iaL6G9yeMN5QUKj9qLVWmiueTQMAOlZXyGBa6pVASxFUIq8paxPltHLhsegMCzMNERUNmFFx_2pzmVrkJ5LdF8rdKST6UnVRfu_Iw9HOr61WLZujG95qNu0aqB39E3ZPfJHKxuDi5lgGiCO03M1GAuO2hFpNX2CEDz5aJ6oBmyHbsd"/>
<div class="absolute top-2 right-2 glass-panel px-2 py-1 rounded-md text-[10px] font-bold text-secondary-fixed">EP 04</div>
</div>
<h4 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Void Weaver</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">Magic • Fantasy</p>
</div>
<!-- Card 3 -->
<div class="flex-none w-40 md:w-56 group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 bg-surface-container shadow-xl transition-transform duration-300 group-hover:scale-105 group-hover:shadow-primary/10">
<img alt="Anime Poster" class="w-full h-full object-cover" data-alt="vibrant flat illustration of a high school student looking out at a sunset sky with painterly clouds" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCs-i985qlxoGihRVps8cZKM5AhEMwJc3eNfJAG3aN_qhX9WUcY3FmLBnY1sA1NAlmL6hyWu7RdRES9mySAvl5Q7uM3l56Fw6jHV8QG7dPV5FeCvzQKxwtKv-DTpocRoGvKF8lJzVCp3s2jxbJurlBpAgxkmiCwO4r_QPHCIiHKdp_cWuI--lsjs5Dpqw9GBT87YbdfxjaaPPsk9Ob8MTIIDzXnTJtpwmoVR5DUINWfQFY_PudqkpYYOA2hb36h9BPiDK8OCEvUPmt8"/>
</div>
<h4 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Summer Reverie</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">Drama • Slice of Life</p>
</div>
<!-- Card 4 -->
<div class="flex-none w-40 md:w-56 group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 bg-surface-container shadow-xl transition-transform duration-300 group-hover:scale-105 group-hover:shadow-primary/10">
<img alt="Anime Poster" class="w-full h-full object-cover" data-alt="moody concept art of a mechanical warrior standing in a desolate winter landscape with glowing orange accents" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB2rEdnywn-J_cPb_-cE-460cePsjP0R5SW_ZHrfbPBlaEDuHUJ4ZsUTJPBqcQTZiR6Sp6hWzu5QF40kSHVM4UFcRfPXZs1xx--1c5gWyJBFUFH4QrbnG80eA6Y-dmYkph1WpScYXa-8RQv9_wsVIT2Wt9aIrWfTMiu-FFhFXl-n6p7FuDq7m5mOlcm84FG1nl8gmE-7-UJj3973VzIUSdra5gQBiZBiTZ86auJF6eTDo1f0qMkqOUqyn-A2ocHdTjgNUmnagPVVzCf"/>
<div class="absolute top-2 right-2 glass-panel px-2 py-1 rounded-md text-[10px] font-bold text-secondary-fixed">EP 24</div>
</div>
<h4 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Iron Vanguard</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">Mecha • Sci-Fi</p>
</div>
<!-- Card 5 -->
<div class="flex-none w-40 md:w-56 group cursor-pointer">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden mb-3 bg-surface-container shadow-xl transition-transform duration-300 group-hover:scale-105 group-hover:shadow-primary/10">
<img alt="Anime Poster" class="w-full h-full object-cover" data-alt="mysterious figure in a hoodie walking through a digital rain code effect in a dark cyberspace environment" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDldsJ35a8mxV37IDaI1aVe__EGmCxMkEu9e40mWWyRl4SjSt-yfvVdw5OGjqAGMyr1z9wbxRf3m4VO_MLm0Q50zzJLvDp7LslnHh_0FetNhEUQyO9jd6B9rPxuR-slhVpMPNLc4okR6QqwV1UzUsOxoEugL9KtzkDK-6klS435ogb9fA3LljnH-h3E-zCMa7nW7FhBy9OHy9j4ISA8_S-9fFfrNdS2fAYwFItLyezaCMdyPwom3b6RUmqQtcuVeS_d-CeopS78BSS-"/>
</div>
<h4 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Ghost Protocol</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">Thriller • Tech</p>
</div>
</div>
</section>
<!-- Recommended for You (Bento Grid) -->
<section class="px-6 md:px-16">
<h3 class="font-headline text-2xl font-bold tracking-tight mb-8">Personalized <span class="text-primary">Picks</span></h3>
<div class="grid grid-cols-1 md:grid-cols-4 gap-4 auto-rows-[200px]">
<!-- Large Feature -->
<div class="md:col-span-2 md:row-span-2 relative rounded-2xl overflow-hidden group cursor-pointer shadow-2xl">
<img alt="Recommendation" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" data-alt="dynamic scene of an esports gamer at a futuristic workstation with intense purple lighting and high-tech interface overlays" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBo5yktIt-7yutHzeyvFv-mm8WlL5vmv8MQQYyFBQ5YvcvfBH6dHOhtn4mWd0TseHeUinZZLKGxtBOrWWJ63jdNB5gCMr2kqUdzbDhZZnGgVc-W9PUyEAxS1J-TLeoQF90buerCsUe4vPTu17Gq1C_GAYTxBfUIe-SrsDo3bBiI303X9G3POD7PLEOe5o5tfExamgzntYNIjhc5isT7KtqwaGQ8udzFw08avwAKp7UyeZsFnbTDGriOO0-MvNGaG99qPTcxe3j3yvLb"/>
<div class="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent p-6 flex flex-col justify-end">
<h4 class="text-3xl font-headline font-black tracking-tight mb-2">PRO GAMER: ZERO</h4>
<p class="text-on-surface-variant text-sm line-clamp-2 mb-4">Because you watched Cyber Valkyrie</p>
<div class="flex gap-2">
<span class="bg-primary/20 text-primary px-3 py-1 rounded-md text-[10px] font-black tracking-widest uppercase">98% MATCH</span>
</div>
</div>
</div>
<!-- Medium Feature -->
<div class="md:col-span-2 md:row-span-1 relative rounded-2xl overflow-hidden group cursor-pointer bg-surface-container">
<div class="flex h-full">
<div class="w-1/2 h-full overflow-hidden">
<img alt="Recommendation" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" data-alt="serene traditional japanese landscape with a red bridge crossing a misty pond under a full moon" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBYPdjdp3Yjm3wnfEtOxVRDBweUVgzzPHylEZjJ866UK0V4QrKmofmyRYcEUP7YiUxVFGGZC2Oa8s1vU1AK-bLFvNmkRaFNizEaIQ_6bxeFS4IuONzubUVx7-BnyPlHOUJ81oUkmBcl0dZ0CYVgYlSOv3r6ZpVEJnqoVYNV7jQ2P-sENxTY83UFJxm1anrB8sXrNnjIUPW-EUyyV1GJsaAFgZ_Gnt5Qoi9eLL1xlAyRqNxkZb05gABHu3mrsvRdweXDoCDX10rN9YoH"/>
</div>
<div class="w-1/2 p-4 flex flex-col justify-center">
<span class="text-tertiary font-black text-[10px] tracking-widest uppercase mb-1">New Release</span>
<h4 class="font-headline font-bold text-lg leading-tight mb-2">Moonlight Shrine</h4>
<p class="text-xs text-on-surface-variant line-clamp-2">A mystical journey through forgotten spirits.</p>
</div>
</div>
</div>
<!-- Small Features -->
<div class="md:col-span-1 md:row-span-1 relative rounded-2xl overflow-hidden group cursor-pointer shadow-xl">
<img alt="Recommendation" class="w-full h-full object-cover" data-alt="vibrant abstract gradient background with flowing waves of electric purple and magenta" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBC-E0L8IN1ngFEuqiEVcUyNmMWQZ9pj_yztrRVdslwztTsTDnZ5r-BWvXag9q_F_LR0JxZUzEk7YY8lN4krKUSKm6hLxs9SQDiyzFh9gvAny2CTOxBZRTogY48S5Bh_-CaEqn8dpDjF3eunoiNpHA-EMIhNIh0pytbYV91gPrcVtCsS3XryXHgOUxPeiZBHFadOdVSZTXiBakYoZGLKwD8_Fmx8uPtT4m1WcwjKBPBJDqgrSN25IB6y3870Y4tgZgsZpa3ES40HJrS"/>
<div class="absolute inset-0 bg-black/40 p-4 flex flex-col justify-end">
<h4 class="font-bold text-sm">Aesthetic Beats</h4>
</div>
</div>
<div class="md:col-span-1 md:row-span-1 relative rounded-2xl overflow-hidden group cursor-pointer shadow-xl">
<img alt="Recommendation" class="w-full h-full object-cover" data-alt="cinematic top-down view of a dense forest with a hidden ancient stone temple glowing with mystical blue light" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAp5qvzHnHP-Gvhfbe_wZzMz9kRETXvXpb4Ybkb1u8_IhlS8dzgsfwk_bkRvzpD_QLi4QUjpCIaEouKada8aNnis2tnj2kVZXnCSvZYXtF09GHCrDJ6lpcJ9nquC9AEbDQCi8Ht9NpZxuYXZ4UhR-uR0XP8hVb6VDjHZXz6w_aMDZK1IR0PB0BpmL7sMvrTef1xud78kS9ohTDeDVqSs1QYhRMlBRqVMnpOIMy0In6vy6i4PxUPApBMsl2esanH1WotaYazTwuX5EIa"/>
<div class="absolute inset-0 bg-black/40 p-4 flex flex-col justify-end">
<h4 class="font-bold text-sm">Fabled Woods</h4>
</div>
</div>
</div>
</section>
<!-- Continuing Watching (Horizontal Cards) -->
<section class="pl-6 md:pl-16">
<h3 class="font-headline text-2xl font-bold tracking-tight mb-6">Continue <span class="text-secondary">Watching</span></h3>
<div class="flex gap-6 overflow-x-auto hide-scrollbar pb-8 pr-6 md:pr-16">
<!-- Progress Card 1 -->
<div class="flex-none w-72 md:w-80 group cursor-pointer">
<div class="relative aspect-video rounded-xl overflow-hidden mb-3 bg-surface-container">
<img alt="Watch Progress" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" data-alt="vibrant neon city lights blurred in a bokeh effect with a sleek high-speed train passing through the frame" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBSxb_2lRpQ0qi0ztUvOmpiALM3pYVO-upbCEhICSCc2xYcv4U_3KpUHnPiijXfNv62usadEgqlYlf116akwiLsXfjvkXCJkS4pjUYueK4rfF8cWLcgCFevX_8gYttIUIpu9IoNv24ghgqcz8fpRq5h1OpCMkPsWIWMppQ4OI4d6ka-PoePuTcO8ufEYw3Jy1ETA3GRC2ucY8eqJZywUUNBCXJnDq9IZrDk2d-owHhdW_fHzIcmkCADbPLuEUz4lp__Rv6icIbJ_y4s"/>
<div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
<div class="w-12 h-12 bg-primary/90 rounded-full flex items-center justify-center text-on-primary">
<span class="material-symbols-outlined fill" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
</div>
</div>
<!-- Progress Bar -->
<div class="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
<div class="h-full bg-secondary shadow-[0_0_8px_rgba(0,227,253,0.8)]" style="width: 65%;"></div>
</div>
</div>
<div class="flex justify-between items-start">
<div>
<h4 class="font-bold text-sm">Neon Drift</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">S1 : E08 • 14:20 left</p>
</div>
</div>
</div>
<!-- Progress Card 2 -->
<div class="flex-none w-72 md:w-80 group cursor-pointer">
<div class="relative aspect-video rounded-xl overflow-hidden mb-3 bg-surface-container">
<img alt="Watch Progress" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" data-alt="wide shot of a vast nebula in deep space with vibrant swirling clouds of cosmic gas and distant stars" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCQvQBBpnZsc4KH4WoUX_isebfd8h3oNn8r45ItDVkhkPvlK_CQjiOUbWMv65hWDkpy3uoPl63V6pxphNhhdctS2j7A9FV1nFUfm7P6DfeCAtEdkaPr1-EQYvvCyecYNl8YrM_TPvxbNT_687eNvW-bwhCqMKfHGOZXIcn1XH-05CksMHhuOP76iyEW2pnemd0B_doktNQnY4Odbo3nItvree-hjWIhEi4aqDKptk7hQk1Fkx6iT9tQ1lPL8xxhW-EWLry7OTFY-kFo"/>
<div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
<div class="w-12 h-12 bg-primary/90 rounded-full flex items-center justify-center text-on-primary">
<span class="material-symbols-outlined fill" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
</div>
</div>
<div class="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
<div class="h-full bg-secondary shadow-[0_0_8px_rgba(0,227,253,0.8)]" style="width: 30%;"></div>
</div>
</div>
<div class="flex justify-between items-start">
<div>
<h4 class="font-bold text-sm">Starbound Voyage</h4>
<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">S2 : E01 • 21:05 left</p>
</div>
</div>
</div>
</div>
</section>
</div>
</main>
<!-- Bottom Navigation Shell (Mobile Only) -->
<footer class="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-3 bg-[#131316]/60 backdrop-blur-2xl z-50 rounded-t-2xl border-t border-[#bd9dff]/15 shadow-[0_-10px_40px_rgba(189,157,255,0.05)]">
<a class="flex flex-col items-center justify-center text-[#bd9dff] bg-[#bd9dff]/10 rounded-xl px-4 py-1 shadow-[0_0_15px_rgba(189,157,255,0.2)] active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined" data-icon="home">home</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Home</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined" data-icon="explore">explore</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Explore</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined" data-icon="subscriptions">subscriptions</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Library</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Admin</span>
</a>
</footer>
</body></html>

<!-- Home - Anime App -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>NEON CURATOR - Anime Details</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800;900&amp;family=Be+Vietnam+Pro:wght@100;300;400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "on-primary": "#3c0089",
              "on-tertiary-fixed-variant": "#6e1c00",
              "primary-dim": "#8a4cfc",
              "tertiary-dim": "#ff7346",
              "on-error-container": "#ffb2b9",
              "secondary-fixed": "#26e6ff",
              "surface-container-high": "#1f1f23",
              "on-surface": "#f0edf1",
              "surface-container-low": "#131316",
              "error-container": "#a70138",
              "error": "#ff6e84",
              "primary-container": "#b28cff",
              "tertiary-fixed": "#ff9473",
              "on-secondary-container": "#e8fbff",
              "on-primary-fixed": "#000000",
              "secondary-container": "#006875",
              "background": "#0e0e11",
              "outline": "#767579",
              "secondary-fixed-dim": "#00d7f0",
              "inverse-on-surface": "#555458",
              "primary": "#bd9dff",
              "tertiary-container": "#fc4c00",
              "on-secondary": "#004d57",
              "inverse-surface": "#fcf8fd",
              "on-error": "#490013",
              "surface": "#0e0e11",
              "surface-container-highest": "#25252a",
              "surface-container-lowest": "#000000",
              "surface-variant": "#25252a",
              "error-dim": "#d73357",
              "secondary-dim": "#00d4ec",
              "tertiary": "#ff7346",
              "on-tertiary-container": "#0e0100",
              "outline-variant": "#48474b",
              "on-tertiary-fixed": "#340800",
              "on-primary-container": "#2e006c",
              "surface-tint": "#bd9dff",
              "secondary": "#00e3fd",
              "surface-bright": "#2c2c30",
              "on-background": "#f0edf1",
              "primary-fixed-dim": "#a67aff",
              "on-secondary-fixed": "#003a42",
              "on-secondary-fixed-variant": "#005964",
              "on-tertiary": "#420d00",
              "surface-dim": "#0e0e11",
              "primary-fixed": "#b28cff",
              "tertiary-fixed-dim": "#ff7d54",
              "inverse-primary": "#742fe5",
              "surface-container": "#19191d",
              "on-primary-fixed-variant": "#390083",
              "on-surface-variant": "#acaaae"
            },
            fontFamily: {
              "headline": ["Space Grotesk"],
              "body": ["Be Vietnam Pro"],
              "label": ["Be Vietnam Pro"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }
      .glass-panel {
        background: rgba(25, 25, 29, 0.6);
        backdrop-filter: blur(24px);
      }
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
      .text-glow-primary {
        text-shadow: 0 0 15px rgba(189, 157, 255, 0.4);
      }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary/30">
<!-- Top AppBar (from JSON) -->
<header class="fixed top-0 left-0 w-full flex justify-between items-center px-6 py-4 bg-[#0e0e11]/60 backdrop-blur-xl z-50 shadow-[0_4px_30px_rgba(189,157,255,0.08)] bg-gradient-to-b from-[#131316] to-transparent">
<div class="flex items-center gap-4">
<div class="w-10 h-10 rounded-full border border-primary/20 overflow-hidden">
<img alt="User Profile Avatar" class="w-full h-full object-cover" data-alt="portrait of a stylized anime character avatar with purple highlights and futuristic gear" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBt3GYhvRLAAjimxmMMSSpJdGiKMfdbEKHUPaws9kRHMIhq3YkfTSwjPxxeOQ8gv36dUc6FkBj49v0uCuEyG2vwwFli9stGpM4wJUPHP2gh9BOeP3C1brLl5Xhnom7sStUw7mD_LnO1z3WQFW5UXRGy140I0wo8Bcxe6OUM8E7Ed8JhqsnDm3l18a6RKWfYaMqWlWsnhrttoDStIjtn2jyMW3gm8j5MsR_a7kyolb9Rhf3E1zDMuk1HsYXjjc6u-Es1EonAgXn_X143"/>
</div>
<h1 class="text-xl font-black tracking-tighter text-[#bd9dff] uppercase font-['Space_Grotesk']">NEON CURATOR</h1>
</div>
<div class="flex items-center gap-6">
<span class="material-symbols-outlined text-[#acaaae] hover:text-[#00e3fd] transition-colors duration-300 cursor-pointer">search</span>
</div>
</header>
<main class="pb-32">
<!-- Hero Section -->
<section class="relative w-full h-[751px] overflow-hidden">
<img alt="Key Art" class="w-full h-full object-cover scale-105" data-alt="cinematic widescreen digital art of a futuristic cyber city at night with neon lights reflecting on wet streets and high-tech skyscrapers" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAgwBzvOp3k3YzimMSPRH86MVtS0BBXmUyN6ZpyqKJoCdVVRNP81jf4HwE8QYNf43cyVcTmpDWo-Gxzpfe_NDjxpf6fdscpmSEizVAE8u_9tAz4haJXUvBIWLwPqr5O9vUnaugCIzdb5chlx5qS5ToOWs8YA6Umtw5HEC4szuW7C0Qma8vy9aAo1D5uG1173pZijOrCJpWaZzBm_EtGcBAy0Ad_KtMbUPG0zd-T9UwJSqMrzScexVRFI7B_DHTk3PGa0tmtqfHLczcS"/>
<!-- Atmospheric Overlays -->
<div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
<div class="absolute inset-0 bg-gradient-to-r from-background via-transparent to-transparent"></div>
<!-- Hero Content -->
<div class="absolute bottom-0 left-0 w-full p-8 md:p-16 flex flex-col items-start gap-6">
<div class="flex gap-3">
<span class="px-3 py-1 bg-primary/10 border border-primary/20 rounded-md text-[10px] font-bold uppercase tracking-widest text-primary">Season 1</span>
<span class="px-3 py-1 bg-secondary/10 border border-secondary/20 rounded-md text-[10px] font-bold uppercase tracking-widest text-secondary">Cyber-Noir</span>
</div>
<h1 class="font-headline font-black text-6xl md:text-8xl tracking-tighter text-glow-primary leading-[0.9]">
                  STORM<br/>
<span class="text-secondary italic">CHASER</span>
</h1>
<p class="max-w-2xl text-on-surface-variant text-lg leading-relaxed line-clamp-3 md:line-clamp-none">
                  In the flooded ruins of Neo-Yokohama, a silent war is fought not with bullets, but with data. Follow Kenji as he navigates the electric underworld to find the source of the Great Cascade.
                  <button class="text-secondary font-bold hover:underline inline ml-2">Read More</button>
</p>
<div class="flex flex-wrap items-center gap-6 mt-4">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-tertiary" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="font-headline text-2xl font-bold">9.8</span>
<span class="text-on-surface-variant text-sm">Rating</span>
</div>
<div class="flex gap-4">
<button class="px-8 py-3 bg-gradient-to-br from-primary to-primary-dim rounded-full flex items-center gap-3 active:scale-95 transition-transform">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
<span class="font-headline font-bold uppercase tracking-wide text-on-primary">Watch Now</span>
</button>
<button class="w-12 h-12 flex items-center justify-center rounded-full border border-outline-variant hover:bg-surface-bright transition-colors group">
<span class="material-symbols-outlined group-hover:text-primary transition-colors">add</span>
</button>
</div>
</div>
</div>
</section>
<!-- Cast & Crew (Horizontal Scroll) -->
<section class="mt-12 px-8 md:px-16">
<div class="flex justify-between items-end mb-8">
<div>
<h2 class="font-headline text-3xl font-bold tracking-tight">Cast &amp; Crew</h2>
<div class="h-1 w-12 bg-secondary mt-2"></div>
</div>
<button class="text-on-surface-variant text-sm font-bold uppercase tracking-widest hover:text-secondary transition-colors">View Full Team</button>
</div>
<div class="flex gap-6 overflow-x-auto no-scrollbar pb-8 -mx-4 px-4">
<!-- Cast Item 1 -->
<div class="flex-shrink-0 group">
<div class="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden mb-4 border-2 border-transparent group-hover:border-primary transition-all duration-300">
<img alt="Voice Actor" class="w-full h-full object-cover" data-alt="professional headshot of a person with stylish hair and dramatic studio lighting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCcEsOaPZHBrID-VEv5NwrBF_4U4WORdlp9tdJ8D1on8VLe7w7TjOaOLvakq_EsmnxvbOAeu0aFhevnbcP-h3YpG148-nAI6z8F5GfChqXikLw35IoZlLp8x0Bh9CmH0LWQWKICC1QtuVH1LtLPXzCUaj8c9FqE3dJIlADFE0Cp8eJhpgKnSAAO8C2Fx_YjEgoExEbOfNZ5mRjbi5pE6XSeCGCObvix2FuEh-pmVVRjh8wr-zCWQTZ005p0F6-148a54auIFUQWLGnw"/>
</div>
<h4 class="font-bold text-sm text-center">Yuki Tanaka</h4>
<p class="text-xs text-on-surface-variant text-center">Voice of Kenji</p>
</div>
<!-- Cast Item 2 -->
<div class="flex-shrink-0 group">
<div class="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden mb-4 border-2 border-transparent group-hover:border-primary transition-all duration-300">
<img alt="Voice Actor" class="w-full h-full object-cover" data-alt="close up headshot portrait of a voice actress with colorful hair and friendly expression" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD2n_jHg21AuXTweiEGH7ZiZ3RkpBWsUbpNnIe6s_QfTuUwA-5gmmAZ8US5crF3la_93uohMk1QcSiQHN5HtwX542qxcC9shnPVfrqTQbb5h6ODLv552N3ijwkiVyUrS4Ke2-ZT0UD3jYgFif9frysoVfH5jsV_p3CbK9aHvFEKun6KdFLLNZLLxApnJIgmFwpEQ9kCxhe9oY2vqCFOHIMyqFpfdgY25chkHRpTEAMeQivYGDgofVKrP2Qik1ZtgodfrSPS4pUUYlJp"/>
</div>
<h4 class="font-bold text-sm text-center">Hina Sato</h4>
<p class="text-xs text-on-surface-variant text-center">Voice of Rei</p>
</div>
<!-- Cast Item 3 -->
<div class="flex-shrink-0 group">
<div class="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden mb-4 border-2 border-transparent group-hover:border-primary transition-all duration-300">
<img alt="Director" class="w-full h-full object-cover" data-alt="artistic portrait of an anime director wearing glasses in a creative office setting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBcGnrl4ZMIZdDKNjPfX7ahYKdiwYZ0wechB6PWda0w2hEj25OKxr9pwOxgff-9j_6JmZyeHY9ywCPFPut45SEOuKayXtdCx9Kb2IJdsZV-doId83-WdDuMTg93YNkZYIVNd1EoMOTTxCiUPmW0pSZ0jOEjXRdWPTAmsiczY119aeEwtlfR1JwbvG46JRHnhcBBzboKYuX9r_8UxN5JLM9RyI3-B4Q2LFQr4gZif0G4MW1kEvqP5wwIUdADWoquyS-4yfjt1wgAJTNz"/>
</div>
<h4 class="font-bold text-sm text-center">Ken Otsuka</h4>
<p class="text-xs text-on-surface-variant text-center">Director</p>
</div>
<!-- Cast Item 4 -->
<div class="flex-shrink-0 group">
<div class="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden mb-4 border-2 border-transparent group-hover:border-primary transition-all duration-300">
<img alt="Voice Actor" class="w-full h-full object-cover" data-alt="portrait of a man with expressive eyes and modern fashion style" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB_ca2pf8NR-KRBb6HUoh7gCiwDDypuisJ7JH_YWaD8P33Otz21o3g6bsGIdaONQnvTPstoExaylFYsid968lvX2Jh1F_1NSFtT4oKR0RVnSIBl4jBMcYE9TKKMbX6ah8sqOuP2O3SZpub9xwD4l-T8FcfWXpTtWnA3zDQdOECprf3Eg2cEPSxEGPGUz7XjTT3AGkA66QcCyZtccFd_oDFfZra5Hgn_jLTPAncu9mbImDuR0qisH2NVsL-4_vjkYlgSEwVKXMAf2tIa"/>
</div>
<h4 class="font-bold text-sm text-center">Ryu Mori</h4>
<p class="text-xs text-on-surface-variant text-center">Voice of Ghost</p>
</div>
<!-- Cast Item 5 -->
<div class="flex-shrink-0 group">
<div class="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden mb-4 border-2 border-transparent group-hover:border-primary transition-all duration-300">
<img alt="Voice Actor" class="w-full h-full object-cover" data-alt="headshot of a young woman with a sharp look and professional voice acting setup behind her" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAFRTNe7_RJ38OnT2XCl2s-8qvFGdMOLrWsXBzag2bqVRFxLBlhXET9PjFr5ViuxDWpN8nn9PTTcKCX_eotzi_l0tuZDwHfAycFnq4Fy1EUWa4F7ctQU6bdPyg9jUwrot1tKTZa0xK8nmaB_jgM_iMCwrHKgH50pq_t0TbGcNbSad4nBe3EcspZlq_ItqZV0QZ2-KifUK6TQMn5rlS4EWgl05JiAoEy5NrJRmXqagh-hMN1yBelUgLf8J84dWjgTaHbEdUAT62cEk2K"/>
</div>
<h4 class="font-bold text-sm text-center">Mika Kudo</h4>
<p class="text-xs text-on-surface-variant text-center">Voice of Commander</p>
</div>
</div>
</section>
<!-- Episodes Section (Bento Grid / List Mix) -->
<section class="mt-12 px-8 md:px-16">
<div class="flex items-center gap-6 mb-8">
<h2 class="font-headline text-3xl font-bold tracking-tight">Episodes</h2>
<div class="flex-grow h-[1px] bg-outline-variant/30"></div>
<div class="flex bg-surface-container rounded-lg p-1">
<button class="px-4 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-md">Season 1</button>
<button class="px-4 py-1.5 text-on-surface-variant text-xs font-bold">Season 2</button>
</div>
</div>
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
<!-- Episode 1 -->
<div class="group relative bg-surface-container rounded-2xl overflow-hidden hover:bg-surface-container-high transition-colors">
<div class="aspect-video relative overflow-hidden">
<img alt="EP 1" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" data-alt="atmospheric scene from an anime with dark clouds and purple lightning striking a futuristic tower" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDVBzMBGpTOEqk7HSFH9pEq_cH0G6jL5_zCzoBZtlh5NtPFRG9bMDcmJLz0sdnIyfhHp2_qUZq94l2Gk2EtLtT7Ei988-Ir3-iegLPGSHzOgvMIn08Lwvz4j-W7ZGuVD7VpWROFl3cSSdNR-5ggVgFDOBIFnDd2crsKTn7YK3OOn8TCa9MVErrXrSNrakDf4dPIztCzM02pqRs7S6f56lOeIyrrre8ZcHihDlRjnD3d6wjU6RbvNBTWeqNnmaxeb2O9_-a1uuevj9oT"/>
<div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
<span class="material-symbols-outlined text-4xl text-white">play_circle</span>
</div>
<div class="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-[10px] font-bold rounded text-white">24:00</div>
</div>
<div class="p-4">
<div class="flex justify-between items-start mb-2">
<span class="font-headline font-bold text-primary tracking-tighter">EP 01</span>
<span class="material-symbols-outlined text-secondary text-sm">download</span>
</div>
<h3 class="font-bold text-lg leading-tight mb-2 group-hover:text-secondary transition-colors">The Digital Deluge</h3>
<p class="text-on-surface-variant text-sm line-clamp-2">Kenji discovers an encrypted signal buried in the city's ancient network that changes everything.</p>
</div>
<!-- Progress Bar -->
<div class="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
<div class="h-full bg-secondary w-full shadow-[0_0_8px_#00e3fd]"></div>
</div>
</div>
<!-- Episode 2 -->
<div class="group relative bg-surface-container rounded-2xl overflow-hidden hover:bg-surface-container-high transition-colors">
<div class="aspect-video relative overflow-hidden">
<img alt="EP 2" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" data-alt="digital landscape of glowing orange lines and data particles flowing like a river" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBqJ0YjrL0cIR7KTtNV9-_GZf4Ex3tNONIgEGRQ7BrL7mFoJ9X2wlC-gYyVOkfvBv0SxwcpSkaZw2tzXAW-FEeDFlRN8e3ieJ4HllCVRb2i6k7dQMWeDZ8Tt70ITuF5DAtW8IThRDpgViV9ZKOgU8ZdAbOEz3EsbVOcXx7YXd4oGVHOh9nvcZYbPX_C6mlyKZrj-nVFbnk4xi4VjJXdMP9gzYtkIimJsa6Vb0mbkOqbakSJu50xxcHdqIWef85rYxe9KXzRHYnF5mCV"/>
<div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
<span class="material-symbols-outlined text-4xl text-white">play_circle</span>
</div>
<div class="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-[10px] font-bold rounded text-white">23:45</div>
</div>
<div class="p-4">
<div class="flex justify-between items-start mb-2">
<span class="font-headline font-bold text-primary tracking-tighter">EP 02</span>
<span class="material-symbols-outlined text-secondary text-sm">download</span>
</div>
<h3 class="font-bold text-lg leading-tight mb-2 group-hover:text-secondary transition-colors">Ghost in the Mesh</h3>
<p class="text-on-surface-variant text-sm line-clamp-2">A mysterious entity starts interfering with Kenji's extraction, leading him into a trap.</p>
</div>
<div class="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
<div class="h-full bg-secondary w-1/3"></div>
</div>
</div>
<!-- Episode 3 -->
<div class="group relative bg-surface-container rounded-2xl overflow-hidden hover:bg-surface-container-high transition-colors">
<div class="aspect-video relative overflow-hidden">
<img alt="EP 3" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" data-alt="mysterious dark room with multiple blue screens glowing and illuminating a silhouette of a character" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBvSmIDdWMQE087sbulRhkzO3hI1m1mXek957hqyhWyA-ayAg5a2a7R-i5cYxVP5uDYtuwKz7-oqy5LeLVZjWjeK7EwwyoW-xsfv7YWQTayRjjHtStyOvp3HwLlinvTLcWVStN6mGOi9geRJXDG7TGo7EUe2GcG-WUNeIoksCKSnY-cMoEOod_LjXdpsL8PaUcUhCLEYdRWd-EJ5uBVqqokpixNbJP5HsJ0bB-P57__E7T9hQcRPc1_WsD74k2zWbYOC9RCQR1MXcac"/>
<div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
<span class="material-symbols-outlined text-4xl text-white">play_circle</span>
</div>
<div class="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-[10px] font-bold rounded text-white">24:12</div>
</div>
<div class="p-4">
<div class="flex justify-between items-start mb-2">
<span class="font-headline font-bold text-primary tracking-tighter">EP 03</span>
<span class="material-symbols-outlined text-secondary text-sm">download</span>
</div>
<h3 class="font-bold text-lg leading-tight mb-2 group-hover:text-secondary transition-colors">Neon Echoes</h3>
<p class="text-on-surface-variant text-sm line-clamp-2">Trapped in the lower levels, the team must rely on an old enemy to find a way out.</p>
</div>
<div class="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
<div class="h-full bg-secondary w-0"></div>
</div>
</div>
</div>
</section>
</main>
<!-- BottomNavBar (from JSON) -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-3 bg-[#131316]/60 backdrop-blur-2xl z-50 rounded-t-2xl border-t border-[#bd9dff]/15 shadow-[0_-10px_40px_rgba(189,157,255,0.05)]">
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined mb-1">home</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest">Home</span>
</a>
<a class="flex flex-col items-center justify-center text-[#bd9dff] bg-[#bd9dff]/10 rounded-xl px-4 py-1 shadow-[0_0_15px_rgba(189,157,255,0.2)] active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined mb-1">explore</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest">Explore</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined mb-1">subscriptions</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest">Library</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined mb-1">dashboard</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest">Admin</span>
</a>
</nav>
</body></html>

<!-- Anime Details -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>NEON CURATOR - Video Player</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&amp;family=Be+Vietnam+Pro:wght@100;300;400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "on-primary": "#3c0089",
              "on-tertiary-fixed-variant": "#6e1c00",
              "primary-dim": "#8a4cfc",
              "tertiary-dim": "#ff7346",
              "on-error-container": "#ffb2b9",
              "secondary-fixed": "#26e6ff",
              "surface-container-high": "#1f1f23",
              "on-surface": "#f0edf1",
              "surface-container-low": "#131316",
              "error-container": "#a70138",
              "error": "#ff6e84",
              "primary-container": "#b28cff",
              "tertiary-fixed": "#ff9473",
              "on-secondary-container": "#e8fbff",
              "on-primary-fixed": "#000000",
              "secondary-container": "#006875",
              "background": "#0e0e11",
              "outline": "#767579",
              "secondary-fixed-dim": "#00d7f0",
              "inverse-on-surface": "#555458",
              "primary": "#bd9dff",
              "tertiary-container": "#fc4c00",
              "on-secondary": "#004d57",
              "inverse-surface": "#fcf8fd",
              "on-error": "#490013",
              "surface": "#0e0e11",
              "surface-container-highest": "#25252a",
              "surface-container-lowest": "#000000",
              "surface-variant": "#25252a",
              "error-dim": "#d73357",
              "secondary-dim": "#00d4ec",
              "tertiary": "#ff7346",
              "on-tertiary-container": "#0e0100",
              "outline-variant": "#48474b",
              "on-tertiary-fixed": "#340800",
              "on-primary-container": "#2e006c",
              "surface-tint": "#bd9dff",
              "secondary": "#00e3fd",
              "surface-bright": "#2c2c30",
              "on-background": "#f0edf1",
              "primary-fixed-dim": "#a67aff",
              "on-secondary-fixed": "#003a42",
              "on-secondary-fixed-variant": "#005964",
              "on-tertiary": "#420d00",
              "surface-dim": "#0e0e11",
              "primary-fixed": "#b28cff",
              "tertiary-fixed-dim": "#ff7d54",
              "inverse-primary": "#742fe5",
              "surface-container": "#19191d",
              "on-primary-fixed-variant": "#390083",
              "on-surface-variant": "#acaaae"
            },
            fontFamily: {
              "headline": ["Space Grotesk"],
              "body": ["Be Vietnam Pro"],
              "label": ["Be Vietnam Pro"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .video-gradient-overlay {
            background: linear-gradient(0deg, rgba(14,14,17,0.9) 0%, rgba(14,14,17,0) 40%, rgba(14,14,17,0) 60%, rgba(14,14,17,0.9) 100%);
        }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary selection:text-on-primary-container overflow-hidden">
<!-- Video Canvas -->
<div class="relative w-screen h-screen bg-black overflow-hidden group">
<!-- Main Video Frame -->
<div class="absolute inset-0 z-0">
<img alt="cinematic anime landscape with neon lights and futuristic city background" class="w-full h-full object-cover" data-alt="cinematic high-quality anime still featuring a futuristic neo-tokyo cityscape at night with glowing purple and cyan neon signs and soft atmospheric haze" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAAHmj_DKNTrvUO5drLSJy3TD5aAOpb2xOEvGg74erD0A2auluF_U0b5okRvTmv_yXIn-ZHHTFFbviqKpEIJVAjRxLRnBiLadlI_9XMYvxtRtbsbm2m7sYPHL7WCMWAyaNnwUkoNRO_DVKERDVtouu2qanqRDvxnaTk7oWKdgn8aPYJPH7aFFVwcpJmfWnjA-tliK-xA356XGhbg3wXoW6kpw17wr957vf5R0hdAkmTjGqyta2LpRnOUm7scOENHn8J1fl1g3iOPfZo"/>
</div>
<!-- UI Overlays (Shared Components Logic: Suppressed Nav Shell for Focus) -->
<div class="absolute inset-0 z-10 video-gradient-overlay transition-opacity duration-700 opacity-100 group-hover:opacity-100 flex flex-col justify-between p-6 md:p-12">
<!-- Top Controls -->
<div class="flex items-center justify-between w-full">
<div class="flex items-center gap-6">
<button class="w-12 h-12 flex items-center justify-center rounded-full bg-surface-container/40 backdrop-blur-md text-on-surface hover:bg-primary/20 transition-all active:scale-90">
<span class="material-symbols-outlined" data-icon="arrow_back">arrow_back</span>
</button>
<div>
<p class="text-secondary font-headline font-bold text-xs uppercase tracking-[0.2em] mb-1">Cyberpunk: Edgerunners</p>
<h1 class="text-on-surface font-headline font-bold text-xl md:text-2xl">S1:E06 • The Girl From The Moon</h1>
</div>
</div>
<div class="flex items-center gap-4">
<button class="px-4 py-2 rounded-lg bg-surface-container/40 backdrop-blur-md border border-outline-variant/20 flex items-center gap-2 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-sm" data-icon="settings">settings</span>
<span class="text-xs font-bold uppercase tracking-widest">Settings</span>
</button>
<button class="w-12 h-12 flex items-center justify-center rounded-full bg-surface-container/40 backdrop-blur-md text-on-surface hover:bg-primary/20 transition-all">
<span class="material-symbols-outlined" data-icon="share">share</span>
</button>
</div>
</div>
<!-- Central Content: Episode Selection Overlay (Hidden by default, shown on click/hover interaction simulation) -->
<div class="hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[530px] overflow-hidden rounded-3xl bg-surface-container-low/80 backdrop-blur-2xl border border-primary/10 p-8 shadow-2xl">
<div class="flex items-center justify-between mb-8">
<h2 class="text-2xl font-headline font-bold text-primary italic uppercase tracking-tighter">Episode Selector</h2>
<span class="text-on-surface-variant text-sm">Season 1 • 10 Episodes</span>
</div>
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto hide-scrollbar">
<!-- Active Episode -->
<div class="relative group cursor-pointer border-2 border-primary rounded-xl overflow-hidden bg-surface-container">
<img class="aspect-video object-cover opacity-60" data-alt="vibrant cyberpunk anime interior scene with many glowing screens and purple lighting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCJSRg9zERLTYYlaELxa2S3SSnLTAHunlSXlOp7gyyxtpSdufm641qCMynEjvNpYIrNijg6148p1i82JZgg-jXpvQeNJ4GrseZFwfGe3Y-8LL9o8dpuXkJGX8JPMIJxs_C67VOB4KUnqUZ3yr4sR6r2LUf3O3kqyavlcObtA-tcE01Y41S_Z0ynkfBn0Vi9c3oTJaTOyCd82m7KJIB5i1_qyHVIgj318y5_sqGG-kcFK-5efbLHlMJ7nytsifWQzNTuIokCbD-uLQhZ"/>
<div class="absolute inset-0 p-3 flex flex-col justify-end">
<span class="text-[10px] font-bold text-primary mb-1 uppercase tracking-widest">Now Playing</span>
<p class="text-sm font-bold truncate">06. The Girl From The Moon</p>
</div>
</div>
<!-- Next Episode -->
<div class="relative group cursor-pointer rounded-xl overflow-hidden bg-surface-container hover:bg-surface-container-high transition-colors">
<img class="aspect-video object-cover opacity-30 group-hover:opacity-60 transition-opacity" data-alt="futuristic street at night in anime style with rain reflections and neon signs" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC8gZ4WgWqxRCW6hN5HVRV673QGgNAX5KR4hlrZvdLPhhskVN3ATUM7bIrb288Tnae1pVAkpJxE3biAioXKhObs0qhyGtDb826lGzXbdZu3CNxXjGu0HueK_QO9DkNouSeWumt6M5B0oaiGPR8ugrC8LEWntQ5Cbif-S3pIKpOHsPuhcQGVRhQaLFv4ggHunB1X3xVR1ZGmbTO9LWEEZge_4uWaROfdSF7CNSh7q1Zgt10a23H1tG_cDiY4koSPUsnCHUJjEkpcNHDi"/>
<div class="absolute inset-0 p-3 flex flex-col justify-end">
<p class="text-sm font-bold truncate text-on-surface-variant group-hover:text-on-surface">07. Stay</p>
</div>
<div class="absolute top-2 right-2">
<span class="material-symbols-outlined text-primary text-lg" data-icon="play_circle" style="font-variation-settings: 'FILL' 1;">play_circle</span>
</div>
</div>
</div>
</div>
<!-- Bottom Controls -->
<div class="w-full space-y-6">
<!-- Next Episode Countdown (Asymmetric Placement) -->
<div class="flex justify-end pr-4">
<div class="group cursor-pointer flex items-center gap-4 bg-surface-container-highest/60 backdrop-blur-xl p-2 pr-6 rounded-full border border-outline-variant/30 hover:border-primary/50 transition-all active:scale-95">
<div class="relative w-12 h-12 rounded-full overflow-hidden border-2 border-secondary">
<img class="w-full h-full object-cover" data-alt="thumbnail for next episode in anime series showing a rainy city" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD67uKBMSq5zJtwj0GGiey6j4JXsj4jTgWH09TGQor9XVtr3XDNYHzMi5j8ywcCjibXV0DWLdgoq0xVsfHzGxWqtLtv3HSmlcgd0la8RuJb2zwYkOD0hV_A-FziFqniMs4meIq7O9P4a6Q80Gjp_21ws4mZMq3HdsqFM8HfBRkqbVs9JMIP1gZJBMjo-IIMTQtaU0tDm7z9X2kGm9qZhhV1-WEy5K6iKXiBFpl2UvDG1gFWgy3csPW8UvwJTF7pc1v394zuGY_SJ6Hc"/>
</div>
<div>
<p class="text-[10px] font-black text-secondary uppercase tracking-widest leading-none mb-1">Up Next in 5s</p>
<p class="text-xs font-bold text-on-surface line-clamp-1">Episode 07: Stay</p>
</div>
<span class="material-symbols-outlined text-secondary ml-2" data-icon="skip_next" style="font-variation-settings: 'FILL' 1;">skip_next</span>
</div>
</div>
<!-- Progress Bar -->
<div class="space-y-2">
<div class="relative h-1.5 w-full bg-surface-container-highest/50 rounded-full overflow-hidden cursor-pointer group/progress">
<div class="absolute top-0 left-0 h-full w-[65%] bg-gradient-to-r from-primary-dim to-secondary shadow-[0_0_12px_rgba(0,227,253,0.5)]"></div>
<div class="absolute top-0 left-[65%] -translate-x-1/2 w-4 h-4 bg-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-[0_0_15px_rgba(255,255,255,0.8)] -mt-1.5 border-4 border-secondary"></div>
</div>
<div class="flex justify-between text-[10px] font-bold font-headline tracking-tighter text-on-surface-variant">
<span class="text-secondary">16:42</span>
<span>24:00</span>
</div>
</div>
<!-- Control Buttons Cluster -->
<div class="flex items-center justify-between">
<div class="flex items-center gap-8">
<button class="text-on-surface hover:text-secondary transition-colors" title="Backward 10s">
<span class="material-symbols-outlined text-3xl" data-icon="replay_10">replay_10</span>
</button>
<button class="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-on-primary shadow-[0_0_30px_rgba(189,157,255,0.4)] hover:scale-110 active:scale-90 transition-all" title="Pause">
<span class="material-symbols-outlined text-4xl" data-icon="pause" style="font-variation-settings: 'FILL' 1;">pause</span>
</button>
<button class="text-on-surface hover:text-secondary transition-colors" title="Forward 10s">
<span class="material-symbols-outlined text-3xl" data-icon="forward_10">forward_10</span>
</button>
</div>
<div class="flex items-center gap-6">
<div class="flex items-center gap-2 group cursor-pointer">
<span class="material-symbols-outlined text-on-surface-variant group-hover:text-secondary transition-colors" data-icon="volume_up">volume_up</span>
<div class="w-20 h-1 bg-surface-container-highest rounded-full overflow-hidden hidden md:block">
<div class="h-full w-4/5 bg-on-surface-variant group-hover:bg-secondary"></div>
</div>
</div>
<button class="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container/20 border border-outline-variant/10 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-xl" data-icon="subtitles">subtitles</span>
<span class="text-xs font-bold font-headline tracking-widest uppercase">EN SUB</span>
</button>
<button class="text-on-surface hover:text-primary transition-colors">
<span class="material-symbols-outlined text-2xl" data-icon="fullscreen">fullscreen</span>
</button>
</div>
</div>
</div>
</div>
</div>
<!-- Background Ambient Glows -->
<div class="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none z-[-1]"></div>
<div class="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/5 rounded-full blur-[120px] pointer-events-none z-[-1]"></div>
</body></html>

<!-- Video Player -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&amp;family=Be+Vietnam+Pro:wght@100..900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script id="tailwind-config">
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "on-primary": "#3c0089",
            "on-tertiary-fixed-variant": "#6e1c00",
            "primary-dim": "#8a4cfc",
            "tertiary-dim": "#ff7346",
            "on-error-container": "#ffb2b9",
            "secondary-fixed": "#26e6ff",
            "surface-container-high": "#1f1f23",
            "on-surface": "#f0edf1",
            "surface-container-low": "#131316",
            "error-container": "#a70138",
            "error": "#ff6e84",
            "primary-container": "#b28cff",
            "tertiary-fixed": "#ff9473",
            "on-secondary-container": "#e8fbff",
            "on-primary-fixed": "#000000",
            "secondary-container": "#006875",
            "background": "#0e0e11",
            "outline": "#767579",
            "secondary-fixed-dim": "#00d7f0",
            "inverse-on-surface": "#555458",
            "primary": "#bd9dff",
            "tertiary-container": "#fc4c00",
            "on-secondary": "#004d57",
            "inverse-surface": "#fcf8fd",
            "on-error": "#490013",
            "surface": "#0e0e11",
            "surface-container-highest": "#25252a",
            "surface-container-lowest": "#000000",
            "surface-variant": "#25252a",
            "error-dim": "#d73357",
            "secondary-dim": "#00d4ec",
            "tertiary": "#ff7346",
            "on-tertiary-container": "#0e0100",
            "outline-variant": "#48474b",
            "on-tertiary-fixed": "#340800",
            "on-primary-container": "#2e006c",
            "surface-tint": "#bd9dff",
            "secondary": "#00e3fd",
            "surface-bright": "#2c2c30",
            "on-background": "#f0edf1",
            "primary-fixed-dim": "#a67aff",
            "on-secondary-fixed": "#003a42",
            "on-secondary-fixed-variant": "#005964",
            "on-tertiary": "#420d00",
            "surface-dim": "#0e0e11",
            "primary-fixed": "#b28cff",
            "tertiary-fixed-dim": "#ff7d54",
            "inverse-primary": "#742fe5",
            "surface-container": "#19191d",
            "on-primary-fixed-variant": "#390083",
            "on-surface-variant": "#acaaae"
          },
          fontFamily: {
            "headline": ["Space Grotesk"],
            "body": ["Be Vietnam Pro"],
            "label": ["Be Vietnam Pro"]
          },
          borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
        },
      },
    }
  </script>
<style>
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    }
    .glass-panel {
      background: rgba(25, 25, 29, 0.6);
      backdrop-filter: blur(24px);
    }
    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .no-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary/30 min-h-screen pb-32">
<!-- TopAppBar -->
<header class="fixed top-0 left-0 w-full flex justify-between items-center px-6 py-4 bg-[#0e0e11]/60 backdrop-blur-xl z-50 shadow-[0_4px_30px_rgba(189,157,255,0.08)] bg-gradient-to-b from-[#131316] to-transparent">
<div class="flex items-center gap-4">
<div class="w-10 h-10 rounded-full border-2 border-primary/30 p-0.5 overflow-hidden">
<img alt="Profile" class="w-full h-full object-cover rounded-full" data-alt="Stylized anime character portrait with neon purple hair and cybernetic visor against a dark background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcy3fEwnAaTaIo0GaEfWLl4wL45ZUZ3yq5gfuU-gmCQ1DOqcDqyub1oug9p3Y1FIoSEDQ2EFTQXS0w4pzqVSS5uLWtpO3teBV502PNScmRqc8oc470a-xGLf8mWQX6TiRNedRSW9nXPCIYYVeNneqr0phY_t-N58R-E6RthkIbp26dK2xuGHja9okrbellh0P2SlntCwn8ke485z5FJfkPBUkBO8qJBK9ghar7W5_zui7jODBQ3TE4n94rUoUXf4AIIMDNXTRyYmUm"/>
</div>
<h1 class="text-xl font-black tracking-tighter text-[#bd9dff] uppercase font-['Space_Grotesk']">NEON CURATOR</h1>
</div>
<div class="flex items-center gap-6">
<span class="material-symbols-outlined text-[#bd9dff] text-2xl cursor-pointer hover:text-[#00e3fd] transition-colors duration-300">search</span>
</div>
</header>
<main class="pt-24 px-6 md:px-12 max-w-7xl mx-auto">
<!-- Hero Title -->
<section class="mb-12 relative">
<div class="absolute -left-10 top-0 w-32 h-32 bg-primary/10 blur-[100px] rounded-full"></div>
<h2 class="font-headline text-5xl md:text-7xl font-bold tracking-tighter text-on-surface">
        My <span class="text-primary italic">Library</span>
</h2>
<p class="text-on-surface-variant mt-2 max-w-md">Your curated digital archive of parallel worlds and neon dreams.</p>
</section>
<!-- Continue Watching Carousel -->
<section class="mb-16">
<div class="flex justify-between items-end mb-6">
<div>
<span class="text-secondary font-label text-xs font-bold uppercase tracking-[0.2em] mb-1 block">In Progress</span>
<h3 class="font-headline text-2xl font-bold">Continue Watching</h3>
</div>
<div class="flex gap-2">
<button class="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container border border-outline-variant/30 hover:border-primary/50 transition-all">
<span class="material-symbols-outlined text-sm">arrow_back_ios_new</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container border border-outline-variant/30 hover:border-primary/50 transition-all">
<span class="material-symbols-outlined text-sm">arrow_forward_ios</span>
</button>
</div>
</div>
<div class="flex gap-6 overflow-x-auto no-scrollbar pb-4 snap-x">
<!-- Item 1 -->
<div class="flex-none w-[280px] md:w-[320px] snap-start group">
<div class="relative aspect-video rounded-xl overflow-hidden mb-4 bg-surface-container shadow-2xl">
<img class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" data-alt="Cinematic wide shot of a futuristic Tokyo skyline at night with glowing purple and cyan skyscrapers and rain-slicked streets" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA3wikoprO0BPI1_grEMDFbIBnBmNkzXf15ngLZQY6P81d2sHhhp3MEtH1V5MCJNXupsTbIljoqs9-GxoVEORANcZl8tRYkr8MW7DecBbmW90lawsp4tuLHOJKOfQr1gLupKcwcdjxy9uNpTOZlDFOVaqoy42XkaQzQr-8W2bSvdKVg2AuteXu6YqoN4iEUdhk0yPIDYWrXjpQz4alIcFkuekj5F1O4-BXaBYGG_9vbRY1ss2a3ZBEPjECqiS5JspY1uGUoPs8EyncM"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent"></div>
<div class="absolute bottom-4 left-4 right-4">
<div class="h-1 w-full bg-surface-variant rounded-full overflow-hidden">
<div class="h-full bg-secondary shadow-[0_0_10px_rgba(0,227,253,0.5)] w-3/4"></div>
</div>
<div class="flex justify-between mt-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
<span>Ep 08 / 12</span>
<span>18:45 left</span>
</div>
</div>
<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
<div class="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/40">
<span class="material-symbols-outlined text-on-primary fill" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
</div>
</div>
</div>
<h4 class="font-headline text-lg font-bold group-hover:text-primary transition-colors">Neo-Genesis: Protocol 9</h4>
<p class="text-on-surface-variant text-sm">Sci-Fi • Cyberpunk</p>
</div>
<!-- Item 2 -->
<div class="flex-none w-[280px] md:w-[320px] snap-start group">
<div class="relative aspect-video rounded-xl overflow-hidden mb-4 bg-surface-container shadow-2xl">
<img class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" data-alt="Vibrant digital art of a celestial dragon weaving through glowing nebula clouds and shattered crystalline structures in deep space" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB-yt9Cuzh3tkwT4MZQLTjHwcpY4HWWuCz-t2qfxBGcZ2ZsSwJXyK590DGmTJgjT5jv69BZepr3hdo9qf6tEnM8XhmpQci8-OGeYJZh14zczOWZUP9d8M9KWr44sP_9AzfdM_7unndRki-3eq2zWqbbeZvx5cYz5ohDTYL0pTyEQkIMEHbfvn-hmv9e5YUObZ-tNldH2cGih3hDsEw_Tg46DyPs8CBgcM727XyWUxMAwyeSGJQcMxI_nIyx55mpEAdnAJZWSvUr4_JY"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent"></div>
<div class="absolute bottom-4 left-4 right-4">
<div class="h-1 w-full bg-surface-variant rounded-full overflow-hidden">
<div class="h-full bg-secondary shadow-[0_0_10px_rgba(0,227,253,0.5)] w-1/4"></div>
</div>
<div class="flex justify-between mt-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
<span>Ep 02 / 24</span>
<span>21:10 left</span>
</div>
</div>
<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
<div class="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/40">
<span class="material-symbols-outlined text-on-primary fill" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
</div>
</div>
</div>
<h4 class="font-headline text-lg font-bold group-hover:text-primary transition-colors">Starlight Voyager</h4>
<p class="text-on-surface-variant text-sm">Space Opera • Adventure</p>
</div>
<!-- Item 3 -->
<div class="flex-none w-[280px] md:w-[320px] snap-start group">
<div class="relative aspect-video rounded-xl overflow-hidden mb-4 bg-surface-container shadow-2xl">
<img class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" data-alt="Mystical forest scene with ancient trees glowing with soft bioluminescence and floating spirit particles at midnight" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAo39MStFxWnuEYX6vhsFNe0kOSy0bVZ-Ulbjrg3tN5qIXn6Na-7bAC_jup_-qPnM18dWGPaMW_9fGg_zWLiMOf1mNI3pcLnn7QnVny0gfD6qMuscw8bMuBTnleul2PcF0hlbZm5u2uG0dcD_MSq8Z7Yo4kFF19pSfpaAyqr25v2J5GLAJk33lSn5PS9FflVqb1OKZwuwmI_1g7HTUDk3s1YZNogptGjvUTJ2-TAlQOm90OrjbBB5TG8x8aAiZv93AOkdFT6G4_Di_P"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent"></div>
<div class="absolute bottom-4 left-4 right-4">
<div class="h-1 w-full bg-surface-variant rounded-full overflow-hidden">
<div class="h-full bg-secondary shadow-[0_0_10px_rgba(0,227,253,0.5)] w-1/2"></div>
</div>
<div class="flex justify-between mt-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
<span>Ep 15 / 15</span>
<span>05:30 left</span>
</div>
</div>
<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
<div class="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/40">
<span class="material-symbols-outlined text-on-primary fill" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
</div>
</div>
</div>
<h4 class="font-headline text-lg font-bold group-hover:text-primary transition-colors">Whispers of Kodama</h4>
<p class="text-on-surface-variant text-sm">Fantasy • Supernatural</p>
</div>
</div>
</section>
<!-- Library Tabs and Filter -->
<section>
<div class="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
<div class="flex bg-surface-container-low p-1 rounded-xl">
<button class="px-6 py-2 rounded-lg bg-primary text-on-primary font-bold text-sm shadow-lg shadow-primary/20">Watchlist</button>
<button class="px-6 py-2 rounded-lg text-on-surface-variant font-bold text-sm hover:text-on-surface transition-colors">Completed</button>
<button class="px-6 py-2 rounded-lg text-on-surface-variant font-bold text-sm hover:text-on-surface transition-colors">Dropped</button>
</div>
<div class="flex items-center gap-3">
<div class="flex items-center gap-2 px-4 py-2 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface-variant hover:border-secondary/40 transition-all cursor-pointer">
<span class="material-symbols-outlined text-lg">filter_list</span>
<span class="text-sm font-bold uppercase tracking-wider">Sort: Recent</span>
</div>
<div class="flex items-center gap-2 px-4 py-2 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface-variant hover:border-secondary/40 transition-all cursor-pointer">
<span class="material-symbols-outlined text-lg">grid_view</span>
</div>
</div>
</div>
<!-- Grid Layout -->
<div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
<!-- Watchlist Card 1 -->
<div class="group relative">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-container mb-3 transition-all duration-300 group-hover:ring-2 group-hover:ring-primary/50 group-hover:-translate-y-2">
<img class="w-full h-full object-cover" data-alt="Dramatic stylized anime poster of a lone warrior standing before a massive mechanical gate in a desert landscape with purple sands" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAxOc8qt_hh75HjXGtaJro0-pu8lc4JvjrmgOeM-ren1KdRlvf1wOC81EXiKsTl8VW8AGG2WSFuCFuqR0jImC5X6X96kWtl26cMBHv6C5eGlfiEl32dopH_iB2q-q79fmBgcueX_PAyRRv7zo1SXxmtce1L6_1kW5Ylq3Sq67oYVaxR3eWfvNByKbF0crxL6kbppMg0yx5QAwp5kfm5HOWzu1QvdlzEU6TltoMCWEWvO2gkk8-8PN4GGJzKkbOW5MwMNGeFuXAzBaF5"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
<div class="absolute top-2 right-2 flex flex-col gap-1">
<span class="bg-secondary/90 text-on-secondary-fixed text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md">SUB</span>
<span class="bg-tertiary/90 text-on-tertiary text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md uppercase">Hot</span>
</div>
<div class="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
<button class="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm">add</span>
                WATCH NOW
              </button>
</div>
</div>
<h5 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Iron Heart: Resurgence</h5>
<div class="flex items-center gap-2 mt-1">
<span class="material-symbols-outlined text-secondary text-xs fill" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[11px] font-bold text-on-surface-variant">8.9</span>
<span class="text-[11px] text-outline">•</span>
<span class="text-[11px] text-on-surface-variant">TV Series</span>
</div>
</div>
<!-- Watchlist Card 2 -->
<div class="group relative">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-container mb-3 transition-all duration-300 group-hover:ring-2 group-hover:ring-primary/50 group-hover:-translate-y-2">
<img class="w-full h-full object-cover" data-alt="Ethereal watercolor style landscape of a floating island city with waterfalls falling into the sky and birds flying through pink clouds" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB-xtZP7TNt-qGNYH-M4dOJGYbT3jAt07qLaIfG-stm1Sdz9ih4ZruR9BiKV7iYP-SNLu31hOkP2Y0fg_2HRD3PMoC_vc9NA0-PoFSGgxMPe1lsF5xrmks6rR-B1RDiDzesnsND4oHWAnGhWw8eMB9hAHg-r7DeWSfWiuxqfogPs0cxUMJ-iqWQaX9l7rs80nbmLFlKXN1w1uq4jTLbGGhIgp7IJVf4Okg62dkcU-xar7JUwiJnTJh_RrPKcTEg83AEU-ni_hPa8ywJ"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
<div class="absolute top-2 right-2">
<span class="bg-surface-bright/80 text-on-surface text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md">DUB</span>
</div>
<div class="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
<button class="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm">add</span>
                WATCH NOW
              </button>
</div>
</div>
<h5 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Aetheria: Sky Islands</h5>
<div class="flex items-center gap-2 mt-1">
<span class="material-symbols-outlined text-secondary text-xs fill" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[11px] font-bold text-on-surface-variant">9.2</span>
<span class="text-[11px] text-outline">•</span>
<span class="text-[11px] text-on-surface-variant">Movie</span>
</div>
</div>
<!-- Watchlist Card 3 -->
<div class="group relative">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-container mb-3 transition-all duration-300 group-hover:ring-2 group-hover:ring-primary/50 group-hover:-translate-y-2">
<img class="w-full h-full object-cover" data-alt="Cyberpunk character with a glowing blue katana standing on a ledge looking out over a vertical mega-city with flying cars" src="https://lh3.googleusercontent.com/aida-public/AB6AXuARwiFeSvUlU58AQYk2hJsotlfxX5Cqr_lxtolJ9eiatEvzoe-yn_IZ6wNIY-ntj-VYdRML7d-TeXbHlaOOolDXA6PYaMeByb3x6jDwEeBFeVkQrIRT2-gdpgngcm47kLDTZFr1VwKe9_appyFuR_3WKcjivF2aP-wvyany0AzOiPF0tkz9R7cNFjonr8ljl9o1W7L2jNl1MwgfEq-IFnk_85sL6Rrl7CQ6Pf0Nns8ktOzSXonSGvIzz_AMfjvyQT_x-heMIHBP9zCA"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
<div class="absolute top-2 right-2">
<span class="bg-secondary/90 text-on-secondary-fixed text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md">SUB</span>
</div>
<div class="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
<button class="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm">add</span>
                WATCH NOW
              </button>
</div>
</div>
<h5 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Blade of the Glitch</h5>
<div class="flex items-center gap-2 mt-1">
<span class="material-symbols-outlined text-secondary text-xs fill" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[11px] font-bold text-on-surface-variant">7.8</span>
<span class="text-[11px] text-outline">•</span>
<span class="text-[11px] text-on-surface-variant">TV Series</span>
</div>
</div>
<!-- Watchlist Card 4 -->
<div class="group relative">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-container mb-3 transition-all duration-300 group-hover:ring-2 group-hover:ring-primary/50 group-hover:-translate-y-2">
<img class="w-full h-full object-cover" data-alt="Abstract anime-style portal made of swirling white and gold energy opening in the middle of a modern city intersection at night" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDRCVR1GDgD0U1fgxB4TUhfUjhyHHOb855_drrqjCVe6_2WHcrqhlqrM77_pKHKvhX3FMZvLfZkq1byYhOv9u1P7mZN-Z73qlKSUbVvXnNdu28wv-bQJ8s2G9K4MfmTrvYtKWsukbsNt1PC-wimXhTh4hpfuRoD7l_dVIZK-aPYKbedXh0DGpD4KZ44SJjv4tnunCsltWSZqUWGyk6YREmCDVvDieUjO_OhQQ3pTXtsYLaIIgg1DfDNfHF4fyTEvJZAL8IhXEvh-tXU"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
<div class="absolute top-2 right-2">
<span class="bg-secondary/90 text-on-secondary-fixed text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md">SUB</span>
</div>
<div class="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
<button class="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm">add</span>
                WATCH NOW
              </button>
</div>
</div>
<h5 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Zero Horizon</h5>
<div class="flex items-center gap-2 mt-1">
<span class="material-symbols-outlined text-secondary text-xs fill" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[11px] font-bold text-on-surface-variant">8.5</span>
<span class="text-[11px] text-outline">•</span>
<span class="text-[11px] text-on-surface-variant">TV Series</span>
</div>
</div>
<!-- Watchlist Card 5 -->
<div class="group relative">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-container mb-3 transition-all duration-300 group-hover:ring-2 group-hover:ring-primary/50 group-hover:-translate-y-2">
<img class="w-full h-full object-cover" data-alt="Cinematic shot of a high-tech armor suit glowing with orange heat vents in a dark underground facility with sparks flying" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA4pBh_o9Y6OyMy0fGMAvIVq5MN79dRko1K1up2vpiBCY9GZKKCjKFoTA7Bzv8vMMEXAtLxOonEa-M9q4Q3igUe_YLF0ffCH2EoCd5CIhFHWmE85bdBxORac1Um9MAo3PSggkg_6Vpq6xy57Rta6yVw889F66vlYvXBAZD8yd5Ne3hULsd511bRrK_BisuQrVUS3xGdlvpx_lWJlkWtfGNN2Om4czVbIZ2jCnYkQgAQgScPO27UvvoxrjxvSu02MJma0pj76OD0q6Q7"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
<div class="absolute top-2 right-2">
<span class="bg-surface-bright/80 text-on-surface text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md">DUB</span>
</div>
<div class="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
<button class="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm">add</span>
                WATCH NOW
              </button>
</div>
</div>
<h5 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Exo-Frame 2100</h5>
<div class="flex items-center gap-2 mt-1">
<span class="material-symbols-outlined text-secondary text-xs fill" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[11px] font-bold text-on-surface-variant">8.1</span>
<span class="text-[11px] text-outline">•</span>
<span class="text-[11px] text-on-surface-variant">OVA</span>
</div>
</div>
<!-- Watchlist Card 6 -->
<div class="group relative">
<div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-surface-container mb-3 transition-all duration-300 group-hover:ring-2 group-hover:ring-primary/50 group-hover:-translate-y-2">
<img class="w-full h-full object-cover" data-alt="Stunning sunset view over a traditional Japanese garden with a red pagoda and cherry blossoms falling onto a reflective koi pond" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDCOWxkCiKBQ891yyOSCdAIocYT6AsY5cIzlz4aKAV9-x_KMUPLz2Uvihvl8sZcZ8Ja9k51VPCs8PHFWEnAMHvEcmvVRHwpr2sTVbFwtch5eFkNfLAf0p7DrRfvKaKSxJZ2wXNiFGwJDpfGkh-IqH9UhBru4Ly7ytQ64UnVewMJM__kBMnntuM0gzXCIWoP9zwJUeEsnIvidQ8QbK6EHl5MXEYBT_Yb9ciNNRzMhKUbngt2AEojS4Ox6jrFS0o7SYZjFfoEIZOOnJ2t"/>
<div class="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
<div class="absolute top-2 right-2">
<span class="bg-secondary/90 text-on-secondary-fixed text-[10px] font-black px-2 py-1 rounded-md backdrop-blur-md">SUB</span>
</div>
<div class="absolute bottom-4 left-4 right-4 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
<button class="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-sm">add</span>
                WATCH NOW
              </button>
</div>
</div>
<h5 class="font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">Eternal Petals</h5>
<div class="flex items-center gap-2 mt-1">
<span class="material-symbols-outlined text-secondary text-xs fill" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="text-[11px] font-bold text-on-surface-variant">9.5</span>
<span class="text-[11px] text-outline">•</span>
<span class="text-[11px] text-on-surface-variant">TV Series</span>
</div>
</div>
</div>
</section>
</main>
<!-- BottomNavBar -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-3 bg-[#131316]/60 backdrop-blur-2xl z-50 rounded-t-2xl border-t border-[#bd9dff]/15 shadow-[0_-10px_40px_rgba(189,157,255,0.05)]">
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined">home</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Home</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined">explore</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Explore</span>
</a>
<a class="flex flex-col items-center justify-center text-[#bd9dff] bg-[#bd9dff]/10 rounded-xl px-4 py-1 shadow-[0_0_15px_rgba(189,157,255,0.2)] active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined fill" style="font-variation-settings: 'FILL' 1;">subscriptions</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Library</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined">dashboard</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Admin</span>
</a>
</nav>
</body></html>

<!-- My Library -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Neon Curator Admin Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&amp;family=Be+Vietnam+Pro:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "on-primary": "#3c0089",
              "on-tertiary-fixed-variant": "#6e1c00",
              "primary-dim": "#8a4cfc",
              "tertiary-dim": "#ff7346",
              "on-error-container": "#ffb2b9",
              "secondary-fixed": "#26e6ff",
              "surface-container-high": "#1f1f23",
              "on-surface": "#f0edf1",
              "surface-container-low": "#131316",
              "error-container": "#a70138",
              "error": "#ff6e84",
              "primary-container": "#b28cff",
              "tertiary-fixed": "#ff9473",
              "on-secondary-container": "#e8fbff",
              "on-primary-fixed": "#000000",
              "secondary-container": "#006875",
              "background": "#0e0e11",
              "outline": "#767579",
              "secondary-fixed-dim": "#00d7f0",
              "inverse-on-surface": "#555458",
              "primary": "#bd9dff",
              "tertiary-container": "#fc4c00",
              "on-secondary": "#004d57",
              "inverse-surface": "#fcf8fd",
              "on-error": "#490013",
              "surface": "#0e0e11",
              "surface-container-highest": "#25252a",
              "surface-container-lowest": "#000000",
              "surface-variant": "#25252a",
              "error-dim": "#d73357",
              "secondary-dim": "#00d4ec",
              "tertiary": "#ff7346",
              "on-tertiary-container": "#0e0100",
              "outline-variant": "#48474b",
              "on-tertiary-fixed": "#340800",
              "on-primary-container": "#2e006c",
              "surface-tint": "#bd9dff",
              "secondary": "#00e3fd",
              "surface-bright": "#2c2c30",
              "on-background": "#f0edf1",
              "primary-fixed-dim": "#a67aff",
              "on-secondary-fixed": "#003a42",
              "on-secondary-fixed-variant": "#005964",
              "on-tertiary": "#420d00",
              "surface-dim": "#0e0e11",
              "primary-fixed": "#b28cff",
              "tertiary-fixed-dim": "#ff7d54",
              "inverse-primary": "#742fe5",
              "surface-container": "#19191d",
              "on-primary-fixed-variant": "#390083",
              "on-surface-variant": "#acaaae"
            },
            fontFamily: {
              "headline": ["Space Grotesk"],
              "body": ["Be Vietnam Pro"],
              "label": ["Be Vietnam Pro"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }
      .glass-panel {
        background: rgba(25, 25, 29, 0.6);
        backdrop-filter: blur(20px);
      }
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-surface font-body selection:bg-primary/30 min-h-screen pb-32">
<!-- TopAppBar -->
<header class="fixed top-0 left-0 w-full flex justify-between items-center px-6 py-4 bg-[#0e0e11]/60 backdrop-blur-xl z-50 bg-gradient-to-b from-[#131316] to-transparent shadow-[0_4px_30px_rgba(189,157,255,0.08)]">
<div class="flex items-center gap-3">
<div class="w-10 h-10 rounded-full bg-surface-container overflow-hidden border border-primary/20">
<img alt="User Profile Avatar" class="w-full h-full object-cover" data-alt="close-up portrait of a professional male designer with a modern haircut and glasses against a dark minimalist background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDS7FOEB7cE2_IcffX5zsmZX0K0PQbmzD8Wdl-kbh9WxoAL3N_vg3vB1cWyMIy-5SPcFrU2ZEDxuFqDVl4K6rNobEBgJYQ8bEN-gNKLjxvoxfX1m9Tll4zkgbwmzV6FbZRZ1vKnrpqq85TCOBD8RlY0lu2dLZs6-rQSWEdB0yQgP_N3oJfdUDYBzSf_0osgFj_EnHRje5D_oKQaSpbE6CCOmNV3WwBGoWs_G4wVOlbv-IBM9p1SOxKLO0VVFs3hxoXImhXSeZckDVgD"/>
</div>
<h1 class="text-xl font-black tracking-tighter text-[#bd9dff] uppercase font-['Space_Grotesk']">NEON CURATOR</h1>
</div>
<button class="text-[#bd9dff] hover:text-[#00e3fd] transition-colors duration-300 active:scale-95 duration-200">
<span class="material-symbols-outlined">search</span>
</button>
</header>
<main class="pt-24 px-6 max-w-7xl mx-auto space-y-10">
<!-- Hero Dashboard Stats (Bento Style) -->
<section class="grid grid-cols-1 md:grid-cols-4 gap-4">
<!-- Active Streamers -->
<div class="md:col-span-2 p-6 rounded-xl bg-surface-container border border-outline-variant/10 shadow-[0_0_40px_rgba(189,157,255,0.03)] relative overflow-hidden group">
<div class="relative z-10 flex flex-col justify-between h-full">
<div class="flex justify-between items-start">
<div>
<p class="text-secondary font-headline font-bold text-sm tracking-widest uppercase mb-1">Live Now</p>
<h2 class="text-4xl font-headline font-bold text-on-surface">1,284</h2>
</div>
<div class="bg-secondary/10 p-2 rounded-lg text-secondary">
<span class="material-symbols-outlined">sensors</span>
</div>
</div>
<div class="mt-8 flex items-end gap-2">
<div class="h-10 w-2 bg-secondary/20 rounded-t-full"></div>
<div class="h-16 w-2 bg-secondary/40 rounded-t-full"></div>
<div class="h-12 w-2 bg-secondary/30 rounded-t-full"></div>
<div class="h-20 w-2 bg-secondary/80 rounded-t-full shadow-[0_0_15px_#00e3fd]"></div>
<div class="h-14 w-2 bg-secondary/50 rounded-t-full"></div>
<div class="h-24 w-2 bg-secondary rounded-t-full shadow-[0_0_20px_#00e3fd]"></div>
<div class="text-xs font-label text-on-surface-variant ml-2 mb-1">+12% vs last hour</div>
</div>
</div>
<!-- Background visual element -->
<div class="absolute -right-10 -bottom-10 opacity-5 group-hover:opacity-10 transition-opacity">
<span class="material-symbols-outlined !text-[120px]" style="font-variation-settings: 'FILL' 1;">sensors</span>
</div>
</div>
<!-- New Signups -->
<div class="p-6 rounded-xl bg-surface-container border border-outline-variant/10">
<p class="text-primary font-headline font-bold text-sm tracking-widest uppercase mb-1">Today's Growth</p>
<h2 class="text-4xl font-headline font-bold text-on-surface">432</h2>
<div class="mt-4 flex items-center gap-2 text-primary">
<span class="material-symbols-outlined text-sm">trending_up</span>
<span class="text-xs font-bold font-label">+24% Weekly</span>
</div>
<div class="mt-6 flex -space-x-2">
<img class="w-8 h-8 rounded-full border-2 border-surface" data-alt="avatar of a young person" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAXjBas0oKw72kMqzVd4EyVzavkZc1sEecpwQm3NXAft3C2CpyjK4N5Qn09qwKEFKk_Iy4-VdwWrp1EPe9wzYuE6Rmkw8YpKcOf5nlZN1_U93yHCFCZwaKU4pp9D-N7JV6NeFMdDO-7KUpZC7DLLZ6oHVfFPh4cVqcMfIO2VvbM-nz-A7Vh1ZHQo-Se2AqQMHfFZOR7gwhldvA6cCNQa2M1udtf_ucXuNamkbaAO1mvCLqlilcQa-tR4tVWzuZ2xec_UAcj2tD5q9hp"/>
<img class="w-8 h-8 rounded-full border-2 border-surface" data-alt="avatar of a woman" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDlnlJ3SVkCZz4qS-uIMIusBE9wSs4d2ScQbbZbPs9iMhEPE0e7Z5lzTFsye7biV5KEdGVo9uVd7-dJ7avK2nMav4rvWv2Wk4ZbK2nUadkxrCOucN0Vn4n1n6B4QwhB2aEn93qZ-B9BOIE9WZx57-q48etuZqQlINuQijqObamKwHbPqgh7MiEndeNm_4AMnujH3TpssDH9FcAp_B8or7xvk1lFUrjdvV4Sp8yBbDvDWn-fMx5SiKm8fL7KGrhYiTeZBU3bucP8h9g2"/>
<img class="w-8 h-8 rounded-full border-2 border-surface" data-alt="avatar of a man" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdeZsxVH1aKuzRCuqpioe0f3yfLAtDlzDiLhmL563Bs9s5jlkwExcSMVGNrbFcWEjxgS1PiwK4qeoFDWzYXWC9InEJJhHpgwVSawZB8amMo0HwG8nS09JgTHBRfEYrmn3KXS1aEWE5yyOQbxBwvCbgfiOQJuGJMnJmHmE8GhbLb9JnODWEpnTUGrEYKcbkxUsGTNbA6VCkiPqp8YPi07kNtV3RNTYucEWOe_lbZvC7SVlvwNvr06XU1CdNLCp3o5TZUoxOlac4_w78"/>
<div class="w-8 h-8 rounded-full border-2 border-surface bg-primary-container flex items-center justify-center text-[10px] text-on-primary-container font-bold">+429</div>
</div>
</div>
<!-- Total Engagement -->
<div class="p-6 rounded-xl bg-surface-container border border-outline-variant/10">
<p class="text-tertiary font-headline font-bold text-sm tracking-widest uppercase mb-1">Total Views</p>
<h2 class="text-4xl font-headline font-bold text-on-surface">2.4M</h2>
<div class="mt-4 h-1 w-full bg-surface-container-highest rounded-full overflow-hidden">
<div class="h-full bg-tertiary w-[85%] shadow-[0_0_10px_#ff7346]"></div>
</div>
<p class="mt-2 text-[10px] text-on-surface-variant font-label uppercase">Goal: 2.8M by End of Month</p>
</div>
</section>
<!-- Main Management Grid -->
<section class="grid grid-cols-1 lg:grid-cols-3 gap-8">
<!-- App Management Toggles (Editorial Control) -->
<div class="lg:col-span-1 space-y-6">
<div class="flex items-center justify-between">
<h3 class="font-headline font-bold text-xl uppercase tracking-tighter text-primary">App Controls</h3>
<span class="material-symbols-outlined text-outline">settings_suggest</span>
</div>
<div class="space-y-4">
<!-- Control Item 1 -->
<div class="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/5">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-secondary">campaign</span>
<span class="text-sm font-medium">Summer Banner</span>
</div>
<button class="relative inline-flex h-6 w-11 items-center rounded-full bg-primary-dim">
<span class="inline-block h-4 w-4 translate-x-6 transform rounded-full bg-white transition"></span>
</button>
</div>
<!-- Control Item 2 -->
<div class="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/5">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-error">engineering</span>
<span class="text-sm font-medium">Maintenance Mode</span>
</div>
<button class="relative inline-flex h-6 w-11 items-center rounded-full bg-surface-container-highest">
<span class="inline-block h-4 w-4 translate-x-1 transform rounded-full bg-outline transition"></span>
</button>
</div>
<!-- Control Item 3 -->
<div class="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/5">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-secondary">verified_user</span>
<span class="text-sm font-medium">Auto-Verify Streamers</span>
</div>
<button class="relative inline-flex h-6 w-11 items-center rounded-full bg-primary-dim">
<span class="inline-block h-4 w-4 translate-x-6 transform rounded-full bg-white transition"></span>
</button>
</div>
</div>
<!-- Reports Section (Community Content Flagging) -->
<div class="pt-6">
<div class="flex items-center justify-between mb-4">
<h3 class="font-headline font-bold text-xl uppercase tracking-tighter text-error">Active Reports</h3>
<span class="px-2 py-0.5 bg-error/20 text-error text-[10px] font-bold rounded-full">12 PENDING</span>
</div>
<div class="space-y-3">
<div class="p-3 bg-surface-container-low rounded-lg border-l-2 border-error flex gap-3">
<div class="w-10 h-10 flex-shrink-0 bg-surface-container-highest rounded overflow-hidden">
<img class="w-full h-full object-cover grayscale opacity-50" data-alt="thumbnail of an anime girl illustration with bright colors" src="https://lh3.googleusercontent.com/aida-public/AB6AXuChTUek68V-x8mOkEcEAHqvIbg_SYzM3MaaddKzYhhdBHBy6ih6VrBT4dN-rFDIOxbW-Mx7Gxu_tDOf76HmGbYSaPx28SjGkEZzcMjqOSV1Ru9HrFWMNqPF3kU-swqUW_LNLKGipXymzOagBo5Nr-e6yKQcaY-grxcjb9okRg_FH-wmtsEiW6LEefZ3GfQyKknDR5uiHKqt2VYnzkq44oBji4n8j8010re1qMNtJf-v9727GsjE5nQPmSrIyZB7nO319AMOii9ovUSO"/>
</div>
<div class="flex-grow">
<div class="flex justify-between items-start">
<p class="text-xs font-bold text-on-surface">Inappropriate Content</p>
<p class="text-[10px] text-on-surface-variant">2m ago</p>
</div>
<p class="text-[10px] text-on-surface-variant">Flagged by: User_Neon42</p>
<div class="flex gap-2 mt-2">
<button class="px-3 py-1 bg-error-container text-on-error-container text-[10px] font-bold rounded-full">REMOVE</button>
<button class="px-3 py-1 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold rounded-full">DISMISS</button>
</div>
</div>
</div>
<div class="p-3 bg-surface-container-low rounded-lg border-l-2 border-error flex gap-3">
<div class="w-10 h-10 flex-shrink-0 bg-surface-container-highest rounded overflow-hidden">
<img class="w-full h-full object-cover grayscale opacity-50" data-alt="abstract digital art with purple neon waves" src="https://lh3.googleusercontent.com/aida-public/AB6AXuClpnL-AQ-OfvDgSPdvieJvVDTIYhWGbqJ4Tm_AnZPXG1_M5WXBoYAGsLBKD_H8cpWtSaVR3zVSRr0BFZcga3ti1DlvXHufEE79wsbYLbFQUANuwJUAXhVhg6-7uYhOsIc_zxOCgEC0Y-pkSzrLgocvK2GIM4Og8WLSHHAhhNP6b_tvG5ZCgtRA0vg7hQ9D8d5k-y1ZOQCdRL9l6A4Bs4HUg7HeUXU_mL2iF8xNUmu3WeEeE8_Dc7O4m3QhlDuxs9vDOsHa6DuR5kIM"/>
</div>
<div class="flex-grow">
<div class="flex justify-between items-start">
<p class="text-xs font-bold text-on-surface">Copyright Strike</p>
<p class="text-[10px] text-on-surface-variant">15m ago</p>
</div>
<p class="text-[10px] text-on-surface-variant">Flagged by: Automated_System</p>
<div class="flex gap-2 mt-2">
<button class="px-3 py-1 bg-error-container text-on-error-container text-[10px] font-bold rounded-full">REMOVE</button>
<button class="px-3 py-1 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold rounded-full">DISMISS</button>
</div>
</div>
</div>
</div>
</div>
</div>
<!-- Recent Uploads & Global Activity -->
<div class="lg:col-span-2 bg-surface-container-low rounded-2xl p-8 border border-outline-variant/5">
<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
<div>
<h3 class="font-headline font-bold text-2xl uppercase tracking-tighter text-on-surface">Recent Content Pipeline</h3>
<p class="text-sm text-on-surface-variant">Monitoring global content ingestion</p>
</div>
<div class="flex gap-2">
<button class="px-4 py-2 bg-primary/10 text-primary text-xs font-bold rounded-xl border border-primary/20">All Sources</button>
<button class="px-4 py-2 text-on-surface-variant text-xs font-bold rounded-xl hover:bg-surface-container-high transition-colors">Only Streams</button>
</div>
</div>
<div class="overflow-x-auto no-scrollbar">
<table class="w-full text-left">
<thead>
<tr class="text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10">
<th class="pb-4 px-2">Content</th>
<th class="pb-4 px-2">Creator</th>
<th class="pb-4 px-2">Duration</th>
<th class="pb-4 px-2">Status</th>
<th class="pb-4 px-2 text-right">Action</th>
</tr>
</thead>
<tbody class="divide-y divide-outline-variant/5">
<!-- Row 1 -->
<tr>
<td class="py-4 px-2">
<div class="flex items-center gap-3">
<div class="w-12 h-16 rounded-lg overflow-hidden bg-surface-container">
<img class="w-full h-full object-cover" data-alt="cinematic close-up of an anime cyborg warrior in rain with cyan neon lights" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC9K9Tpjr4guUzHEOtrasaHLWNRy2cLXaa4Qbvxe9d77mSaTLEdir_WIiMUIaGqgQ_dX2CXCjiIgzZiJ5A4J5-YNdMngaV2r68kA7kmc49oXHOcreHMHs1Ulhm0nzaIyMVQGUXCBdQFWZJOIn_8yuMYUZLPTtFI0ld-ZpnezkTigp1MnQyeqgdrvG9JABNV5nDewek3YIr6JzQPHMbBRZaStyvf2YwR8Y5hftTaCYegK_MIvGSJf4FyHr_W8xV1oGj7pyvrOOZVTudj"/>
</div>
<div>
<p class="text-sm font-bold">Cyber Soul: Ep 4</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">HD • SUB</p>
</div>
</div>
</td>
<td class="py-4 px-2">
<p class="text-xs font-medium">Studio_Icarus</p>
</td>
<td class="py-4 px-2">
<p class="text-xs font-medium">24:05</p>
</td>
<td class="py-4 px-2">
<span class="px-2 py-0.5 bg-secondary/10 text-secondary text-[10px] font-bold rounded-full">PROCESSING</span>
</td>
<td class="py-4 px-2 text-right">
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined">more_vert</span>
</button>
</td>
</tr>
<!-- Row 2 -->
<tr>
<td class="py-4 px-2">
<div class="flex items-center gap-3">
<div class="w-12 h-16 rounded-lg overflow-hidden bg-surface-container">
<img class="w-full h-full object-cover" data-alt="mystical forest landscape with glowing purple flowers and fireflies in a classic anime style" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDChyXxwfUG__8cMm9HKlyrnpbrryDMwpX9SvjI9r_pUEjKPD1a7IE3Nj-QiIgQ1nDXXOT0-efNRxHCiUlpAvfVQWbfZhmBX5kmnGEP6pgvzbyGsgdDolcPxkbza0wQkRYPE469KnFhbXX-0sxE3S_Xqcwkx__uET4CYR_UQGmiYAJwLyWjmonxoh4kdeGcUslpTY8VNKkgPfCkZZbFzkWsAwTxXdj_-Wxa-ZDfbqXaICSkg-GABErqoXWgUtTvP5i9h5Gn3CLMFuBb"/>
</div>
<div>
<p class="text-sm font-bold">Whispers of Kyoto</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">4K • DUB</p>
</div>
</div>
</td>
<td class="py-4 px-2">
<p class="text-xs font-medium">FanSub_Global</p>
</td>
<td class="py-4 px-2">
<p class="text-xs font-medium">45:12</p>
</td>
<td class="py-4 px-2">
<span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">READY</span>
</td>
<td class="py-4 px-2 text-right">
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined">more_vert</span>
</button>
</td>
</tr>
<!-- Row 3 -->
<tr>
<td class="py-4 px-2">
<div class="flex items-center gap-3">
<div class="w-12 h-16 rounded-lg overflow-hidden bg-surface-container">
<img class="w-full h-full object-cover" data-alt="dramatic mountain sunrise over a futuristic city with orange and blue hues" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBqC4V_rDXPoBFkcgCZgHJ6-1NKQ2RSeT6hFgbJQyB2brDc6yiV9I56TjgAWVRxJW0RHNJzziiG4WW0cH1cYkc65Z7R9Jo-IEO4IcAFC_zDHEhqtVrZeDfr7vbAFdWt8sinOc5BWVnsVFM1k0H7HWDdzK5C9d4wiKIAnXsPMDXPwze3EKMme5oxUp-xk8m88kOcE3YnGv81SFnXdgG8e1gYbiie8hhoHH5yiUO0AFb_beXz9UCvwFoTfvsABdkYUZWbc0TyRjlrtV_f"/>
</div>
<div>
<p class="text-sm font-bold">Dawn Runners</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">HD • SUB</p>
</div>
</div>
</td>
<td class="py-4 px-2">
<p class="text-xs font-medium">Neo_Tokyo_TV</p>
</td>
<td class="py-4 px-2">
<p class="text-xs font-medium">12:30</p>
</td>
<td class="py-4 px-2">
<span class="px-2 py-0.5 bg-error/10 text-error text-[10px] font-bold rounded-full">FAILED</span>
</td>
<td class="py-4 px-2 text-right">
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined">more_vert</span>
</button>
</td>
</tr>
</tbody>
</table>
</div>
<!-- Pagination/Load More -->
<div class="mt-8 flex justify-center">
<button class="px-6 py-2 bg-surface-container-highest hover:bg-surface-bright text-on-surface text-xs font-bold rounded-full transition-all border border-outline-variant/10">
                        View Full History Log
                    </button>
</div>
</div>
</section>
</main>
<!-- BottomNavBar -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-3 bg-[#131316]/60 backdrop-blur-2xl z-50 rounded-t-2xl border-t border-[#bd9dff]/15 shadow-[0_-10px_40px_rgba(189,157,255,0.05)]">
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined">home</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Home</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined">explore</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Explore</span>
</a>
<a class="flex flex-col items-center justify-center text-[#acaaae] opacity-70 hover:text-[#00e3fd] hover:opacity-100 transition-all active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined">subscriptions</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Library</span>
</a>
<a class="flex flex-col items-center justify-center text-[#bd9dff] bg-[#bd9dff]/10 rounded-xl px-4 py-1 shadow-[0_0_15px_rgba(189,157,255,0.2)] active:scale-90 duration-150" href="#">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">dashboard</span>
<span class="font-['Be_Vietnam_Pro'] text-[10px] font-bold uppercase tracking-widest mt-1">Admin</span>
</a>
</nav>
<!-- FAB (Suppressed on Admin via Logic, but rendering if context implies critical action) -->
<!-- In this dashboard, we add a FAB for "Emergency Broadcast" or "Quick Announcement" -->
<button class="fixed bottom-24 right-6 w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dim text-on-primary-container shadow-[0_10px_30px_rgba(189,157,255,0.4)] flex items-center justify-center hover:scale-105 transition-transform active:scale-95 z-40">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">add_alert</span>
</button>
</body></html>