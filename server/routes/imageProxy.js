import express from 'express';
import axios from 'axios';

const router = express.Router();

router.get('/', async (req, res) => {
  const imageUrl = req.query.url;

  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
  }

  let decodedUrl = imageUrl;
  try {
    // Attempt to decode if it was encoded by the client
    decodedUrl = decodeURIComponent(imageUrl);
  } catch (e) {
    // If it fails to decode, just use the raw string
  }

  try {
    // Basic validation to ensure it's a valid URL
    new URL(decodedUrl);
    
    // Check if it's already a relative/local URL, which we don't need to proxy
    if (decodedUrl.startsWith('/')) {
      return res.redirect(decodedUrl);
    }

    // Only allow proxying specific known safe domains to prevent SSRF
    // For now, allow anilist, kitsu, mal, and anything from readdy.ai (which are used in the app)
    const allowedDomains = [
      's4.anilist.co', 
      'media.kitsu.io', 
      'cdn.myanimelist.net',
      'myanimelist.net',
      'readdy.ai',
      'static.bunnycdn.ru'
    ];
    
    const urlObj = new URL(decodedUrl);
    const isAllowed = allowedDomains.some(domain => urlObj.hostname.includes(domain));
    
    if (!isAllowed) {
       return res.status(403).json({ error: 'Domain not allowed for image proxying' });
    }

    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      responseType: 'stream',
      // Time out after 10 seconds so we don't hang the server
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Pass common accept headers for images
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      }
    });

    // Pass along caching and content-type headers from the upstream CDN
    const contentType = response.headers['content-type'];
    if (contentType) res.setHeader('Content-Type', contentType);
    
    // Aggressive caching: cache for 1 year (31536000 seconds), immutable
    // This allows the browser to never hit the server again for this image
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Pipe the image stream directly to the response
    response.data.pipe(res);

  } catch (error) {
    console.error(`[ImageProxy] Error fetching image ${decodedUrl}:`, error.message);
    res.status(502).json({ error: 'Failed to proxy image', details: error.message });
  }
});

export default router;
