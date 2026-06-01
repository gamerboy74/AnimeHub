# Vercel Deployment Guide

## Fixing 404 Errors on Reload

### Problem
When you reload pages like `/anime/123` or `/player/animeId/episode` on Vercel, you get 404 errors because the server tries to find those actual files/folders.

### Solution
The `vercel.json` file is already configured to handle this. It rewrites all routes to `index.html`, allowing React Router to handle routing client-side.

## Deployment Steps

### 1. Commit the vercel.json file
```bash
git add vercel.json
git commit -m "Add Vercel configuration for SPA routing"
git push
```

### 2. Deploy to Vercel

**Option A: Via Vercel Dashboard**
1. Go to [vercel.com](https://vercel.com)
2. Connect your GitHub/GitLab repository (if not already connected)
3. Vercel will automatically detect the `vercel.json` file
4. Click "Deploy"

**Option B: Via Vercel CLI**
```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Or deploy to production
vercel --prod
```

### 3. Verify the Fix

After deployment, test these scenarios:

1. **Navigate to a route and reload:**
   - Go to your Vercel URL
   - Navigate to `/anime/123` (or any anime detail page)
   - Press `Ctrl+R` or `F5` to reload
   - ✅ Should work without 404

2. **Direct URL access:**
   - Open a new tab
   - Directly visit: `https://your-app.vercel.app/anime/123`
   - ✅ Should load correctly

3. **Player page reload:**
   - Navigate to `/player/animeId/episode`
   - Reload the page
   - ✅ Should work without 404

4. **Browser back/forward:**
   - Navigate through multiple pages
   - Use browser back button
   - Use browser forward button
   - ✅ All should work correctly

## Configuration Details

### vercel.json Structure

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### What it does:
- **Rewrites**: All routes (except API routes) are rewritten to `index.html`
- **Headers**: Sets proper cache headers for Service Worker and static assets
- **Result**: React Router handles all client-side routing

## Troubleshooting

### If you still get 404 errors:

1. **Check vercel.json is in root:**
   ```bash
   ls vercel.json  # Should show the file
   ```

2. **Redeploy after adding vercel.json:**
   - Make sure `vercel.json` is committed
   - Trigger a new deployment

3. **Check Vercel deployment logs:**
   - Go to Vercel dashboard
   - Check deployment logs for errors

4. **Clear browser cache:**
   - Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

5. **Check if API routes are affected:**
   - If you have `/api/*` routes, they should work normally
   - Only frontend routes are rewritten

## Build Configuration

Make sure your build settings are correct:

1. **Build Command:** `npm run build`
2. **Output Directory:** `out` (as configured in `vite.config.ts`)
3. **Install Command:** `npm install`

These are usually auto-detected by Vercel, but you can verify in your project settings.

## Additional Notes

- The rewrite rule `"source": "/(.*)"` catches all routes
- It excludes actual files (like assets, images, etc.) automatically
- Service Worker is properly configured with headers
- Static assets are cached for performance

## Production Checklist

- [ ] `vercel.json` is committed to repository
- [ ] Build completes successfully
- [ ] Homepage loads correctly
- [ ] Navigation works (clicking links)
- [ ] Reload works on detail pages
- [ ] Reload works on player pages
- [ ] Direct URL access works
- [ ] Browser back/forward works
- [ ] Service Worker works (if enabled)

