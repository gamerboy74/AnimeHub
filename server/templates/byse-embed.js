/**
 * Clean ad-free Bysesayeveum embed page template.
 * Resolves HLS via /api/resolve-stream and plays via hls.js.
 */

export function buildByseEmbedHtml(videoId, startTime, byseUrl) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Player</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  video{position:absolute;inset:0;width:100vw;height:100vh;object-fit:cover;object-position:center;background:#000}
  #loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:10}
  .spinner{width:48px;height:48px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #error{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#000;color:#ef4444;font-family:system-ui;text-align:center;padding:20px;z-index:10}
  #error h3{font-size:16px;margin-bottom:8px}
  #error p{font-size:13px;color:#999}
  #error button{margin-top:12px;padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px}
  #error button:hover{background:#2563eb}
</style>
</head><body>
<div id="loader"><div class="spinner"></div></div>
<div id="error"><div><h3>Failed to load video</h3><p id="errMsg"></p><button onclick="loadVideo()">Retry</button></div></div>
<video id="player" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
const video = document.getElementById('player');
const loader = document.getElementById('loader');
const errorEl = document.getElementById('error');
const errMsg = document.getElementById('errMsg');
const BYSE_URL = ${JSON.stringify(byseUrl)};

async function loadVideo() {
  loader.style.display = 'flex';
  errorEl.style.display = 'none';
  try {
    const r = await fetch('/api/resolve-stream?url=' + encodeURIComponent(BYSE_URL));
    const data = await r.json();
    if (!data.success || !data.hlsUrl) throw new Error(data.error || 'No stream URL returned');
    const hlsUrl = data.hlsUrl;
    console.log('✅ Got HLS:', hlsUrl.substring(0, 80));
    
    let seeked = false;
    const seekToStart = () => {
      if (seeked) return;
      var st = ${startTime};
      if (st > 0 && video.readyState >= 2) {
        const duration = video.duration;
        if (duration && !isNaN(duration) && duration > 0) {
          video.currentTime = Math.min(st, duration - 1);
          seeked = true;
        }
      }
    };
    ['play','playing','loadedmetadata','loadeddata','canplay','durationchange','timeupdate']
      .forEach(e => video.addEventListener(e, seekToStart));

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { loader.style.display = 'none'; video.play().catch(()=>{}); });
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) {
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else { showError('Playback error: ' + d.details); hls.destroy(); }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => { loader.style.display = 'none'; seekToStart(); video.play().catch(()=>{}); });
    } else {
      showError('HLS not supported in this browser');
    }
  } catch (err) {
    console.error('❌', err);
    showError(err.message);
  }
}
function showError(msg) { loader.style.display = 'none'; errorEl.style.display = 'flex'; errMsg.textContent = msg; }

video.addEventListener('timeupdate', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'videojs', event: 'timeupdate', currentTime: video.currentTime, duration: video.duration || 0, paused: video.paused }, window.location.origin);
  }
});
video.addEventListener('ended', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'videojs', event: 'ended', currentTime: video.duration || 0, duration: video.duration || 0, paused: true }, window.location.origin);
  }
});

loadVideo();
</script>
</body></html>`;
}
