/**
 * Clean Mega embed page template.
 * Wraps original mega player in an iframe with progress tracking.
 */

export function buildMegaEmbedHtml(host, videoId, startTime) {
  const megaUrl = `https://${host}/embed/${videoId}`;
  const megaUrlAlt = `https://${host}/e/${videoId}`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Player</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  iframe{width:100%;height:100%;border:none}
  #loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:10;transition:opacity .3s}
  .spinner{width:48px;height:48px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>
<div id="loader"><div class="spinner"></div></div>
<iframe id="player" src="${megaUrl}?autoplay=1${startTime > 0 ? `&start=${startTime}&t=${startTime}` : ''}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"></iframe>
<script>
const iframe = document.getElementById('player');
const loader = document.getElementById('loader');
let started = false;
let watchStart = Date.now();
let startOffset = ${startTime};
let estimatedDuration = 1440; // 24 min default

iframe.addEventListener('load', () => {
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 300);
  started = true;
  watchStart = Date.now();
  iframe.focus();
});

iframe.addEventListener('error', () => {
  iframe.src = ${JSON.stringify(megaUrlAlt + '?autoplay=1')} + (${startTime} > 0 ? '&start=' + ${startTime} + '&t=' + ${startTime} : '');
});

setInterval(() => {
  if (!started || document.hidden) return;
  const elapsed = (Date.now() - watchStart) / 1000 + startOffset;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'videojs', event: 'timeupdate', currentTime: elapsed, duration: estimatedDuration, paused: false }, window.location.origin);
  }
}, 5000);

function checkEnded() {
  if (!started) return;
  const elapsed = (Date.now() - watchStart) / 1000;
  if (elapsed >= estimatedDuration * 0.9) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'videojs', event: 'ended', currentTime: estimatedDuration, duration: estimatedDuration, paused: true }, window.location.origin);
    }
  }
}
setInterval(checkEnded, 10000);

window.addEventListener('message', (e) => {
  if (e.data && typeof e.data === 'object') {
    const ct = e.data.currentTime || e.data.time;
    const dur = e.data.duration;
    if (ct !== undefined && dur) {
      estimatedDuration = dur;
      watchStart = Date.now() - (ct * 1000);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'videojs', event: 'timeupdate', currentTime: ct, duration: dur, paused: e.data.paused || false }, window.location.origin);
      }
    }
  }
});
</script>
</body></html>`;
}
