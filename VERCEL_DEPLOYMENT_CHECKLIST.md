# Vercel Frontend Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. Environment Variables (Critical!)
Make sure you have your Supabase credentials ready. You'll need to add these in Vercel dashboard:

**Required:**
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Optional (for backend server - if deploying):**
```
VITE_BACKEND_URL=http://localhost:3001
```
*Note: Keep as localhost for now since backend runs locally in Docker*

### 2. Files Status
- ✅ `.gitignore` - Created (excludes .env files)
- ✅ `vercel.json` - Configured (handles SPA routing)
- ✅ `.env.example` - Exists (template for others)

---

## 🚀 Deployment Steps

### Step 1: Initialize Git Repository (if not already)

```powershell
git init
git add .
git commit -m "Initial commit - AnimeHub frontend"
```

### Step 2: Push to GitHub

```powershell
# Create a new repository on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/animehub.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy to Vercel

**Option A: Via Vercel Dashboard (Recommended)**

1. Go to https://vercel.com
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `./` (or leave blank)
   - **Build Command:** `npm run build`
   - **Output Directory:** `out`
   - **Install Command:** `npm install`

5. Add Environment Variables:
   - Click "Environment Variables"
   - Add `VITE_SUPABASE_URL` with your Supabase URL
   - Add `VITE_SUPABASE_ANON_KEY` with your anon key
   - Add `VITE_BACKEND_URL` = `http://localhost:3001` (for now)

6. Click "Deploy"

**Option B: Via Vercel CLI**

```powershell
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy (follow prompts)
vercel

# Set environment variables
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# Deploy to production
vercel --prod
```

---

## 🔧 Post-Deployment Configuration

### 1. Get Your Supabase Credentials

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to Settings → API
4. Copy:
   - **Project URL** (VITE_SUPABASE_URL)
   - **anon public key** (VITE_SUPABASE_ANON_KEY)

### 2. Test Your Deployment

After deployment completes:

1. Visit your Vercel URL (e.g., `https://animehub-xxx.vercel.app`)
2. Test authentication (sign up/login)
3. Browse anime list
4. Check video playback
5. Test routing (navigate and refresh pages)

### 3. Known Limitations

⚠️ **Backend Server:**
- Scraping features won't work (backend is local only)
- Admin panel scraping will be disabled
- User features work 100% (powered by Supabase)

**Features that WILL work:**
- ✅ User authentication
- ✅ Browse anime
- ✅ Watch videos
- ✅ Favorites & Watchlist
- ✅ Progress tracking
- ✅ Reviews

**Features that WON'T work:**
- ❌ Admin scraping panel
- ❌ Cached anime queries (will fall back to Supabase)

---

## 🔍 Troubleshooting

### Build Fails

**Error: "Command failed with exit code 1"**
- Check build logs in Vercel dashboard
- Verify all dependencies are in `package.json`
- Make sure TypeScript has no errors: `npm run build` locally

**Error: "VITE_SUPABASE_URL is not defined"**
- Add environment variables in Vercel dashboard
- Redeploy after adding variables

### Runtime Errors

**Error: "Failed to fetch"**
- Check Supabase credentials are correct
- Verify Supabase project is active
- Check browser console for CORS errors

**404 on Page Refresh**
- Verify `vercel.json` exists with rewrites
- Check deployment logs

**Blank Page**
- Check browser console for errors
- Verify build output in Vercel logs
- Test locally: `npm run build && npm run preview`

---

## 📱 Mobile App Development (After Frontend Deploy)

Once frontend is deployed, you can start mobile development:

1. **Use Deployed Frontend as Reference:** See how APIs are called
2. **Use Supabase SDK Directly:** No need for backend server
3. **Follow:** `MOBILE_API_GUIDE.md` for complete API documentation

---

## 🎯 Next Steps After Deployment

### Immediate:
1. ✅ Push code to GitHub
2. ✅ Deploy to Vercel
3. ✅ Set environment variables
4. ✅ Test live site

### Optional (Later):
1. **Custom Domain:** Add your domain in Vercel settings
2. **Deploy Backend:** Deploy Express server to Railway/Render if you need scraping
3. **Monitoring:** Set up Sentry for error tracking
4. **Analytics:** Add Google Analytics or similar

---

## 📋 Deployment Commands Quick Reference

```powershell
# Before deployment
git status                    # Check what will be committed
git add .                     # Stage all changes
git commit -m "message"       # Commit changes
git push origin main          # Push to GitHub

# Vercel CLI
vercel                        # Deploy preview
vercel --prod                 # Deploy to production
vercel logs                   # View deployment logs
vercel env ls                 # List environment variables
vercel domains                # Manage domains

# Redeploy
git add .
git commit -m "Update"
git push                      # Auto-deploys on push (if connected)
```

---

## ✅ Success Criteria

Your deployment is successful when:

- [ ] Site loads at Vercel URL
- [ ] Can sign up/login with email
- [ ] Can browse anime list
- [ ] Can view anime details
- [ ] Can play videos
- [ ] Can add to favorites/watchlist
- [ ] Page refresh doesn't cause 404
- [ ] No console errors

---

## 🆘 Need Help?

- **Vercel Docs:** https://vercel.com/docs
- **Supabase Docs:** https://supabase.com/docs
- **Build Locally First:** Always test `npm run build` before deploying
