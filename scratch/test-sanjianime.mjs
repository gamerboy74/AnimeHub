import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'https://sanjianime.com/watch/one-piece-episode-1162/';

function firstValue(values) {
  return values.find(Boolean) || null;
}

function classifyServer(label) {
  const normalized = (label || '').toLowerCase();
  if (normalized.includes('dub')) return 'dub';
  if (normalized.includes('sub')) return 'sub';
  return 'unknown';
}

function getPlayableUrlFromIframe(iframeSrc, sourceUrls, directM3u8, videoSrc) {
  return firstValue([
    ...(sourceUrls || []),
    ...(directM3u8 || []),
    videoSrc,
    iframeSrc,
  ]);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  try {
    console.log(`Inspecting: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const serverOptions = await page.evaluate(() => {
      return [...document.querySelectorAll('[data-embed-id]')].map((el) => ({
        label: (el.textContent || '').trim().replace(/\s+/g, ' '),
        embedId: el.getAttribute('data-embed-id') || '',
      }));
    });

    const initialIframeSrc = await page.locator('iframe').first().getAttribute('src').catch(() => null);
    if (!initialIframeSrc) {
      throw new Error('No player iframe found on the watch page');
    }

    async function captureCurrentPlayer() {
      const iframeSrc = await page.locator('iframe').first().getAttribute('src').catch(() => null);
      const frame = page.frames().find(
        (f) =>
          (iframeSrc && (f.url() === iframeSrc || f.url().includes(iframeSrc.replace(/^https?:\/\//i, "")))) ||
          /xplayer\.apnshare\.org\/e\//.test(f.url()) ||
          /player\./.test(f.url()) ||
          /videas\.fr\/embed\//.test(f.url()) ||
          /fairuseonly\.xyz\/embed\//.test(f.url()) ||
          /animexyz\./.test(f.url())
      );

      if (!frame) {
        return { iframeSrc, streamUrl: null, error: 'Could not attach to player frame' };
      }

      await frame.waitForTimeout(2000).catch(() => {});
      const activeUrl = frame.url();

      try {
        const evaluateFrame = async (f) => {
          try {
            return await f.evaluate(() => {
              const html = document.documentElement.outerHTML;
              const directM3u8 = [...html.matchAll(/https?:\/\/[^"'\s>]+\.m3u8[^"'\s>]*/g)]
                .map((match) => match[0].replace(/["'`;]$/g, ''));

              const sourceUrls = [...document.querySelectorAll('source')]
                .map((el) => el.getAttribute('src'))
                .filter(Boolean);

              const video = document.querySelector('video');

              return {
                title: document.title || '',
                directM3u8,
                sourceUrls,
                videoSrc: video?.getAttribute('src') || null,
              };
            });
          } catch (e) {
            return null;
          }
        };

        const frameDataList = [];

        // 1. Evaluate the main matching frame
        const mainData = await evaluateFrame(frame);
        if (mainData) frameDataList.push(mainData);

        // 2. Evaluate child frames
        for (const child of frame.childFrames()) {
          const childData = await evaluateFrame(child);
          if (childData) frameDataList.push(childData);

          // 3. Evaluate grandchild frames
          for (const grandchild of child.childFrames()) {
            const grandchildData = await evaluateFrame(grandchild);
            if (grandchildData) frameDataList.push(grandchildData);
          }
        }

        // Aggregate
        const sourceUrls = [];
        const directM3u8 = [];
        const videoSrcs = [];
        let title = '';

        for (const fd of frameDataList) {
          if (fd.title && !title) title = fd.title;
          if (fd.sourceUrls) sourceUrls.push(...fd.sourceUrls);
          if (fd.directM3u8) directM3u8.push(...fd.directM3u8);
          if (fd.videoSrc) videoSrcs.push(fd.videoSrc);
        }

        const streamUrl = getPlayableUrlFromIframe(activeUrl || iframeSrc, sourceUrls, directM3u8, videoSrcs[0]);

        return {
          iframeSrc: activeUrl || iframeSrc,
          frameTitle: title,
          streamUrl,
          sourceUrls,
          directM3u8,
        };
      } catch (error) {
        return {
          iframeSrc: activeUrl || iframeSrc,
          frameTitle: '',
          streamUrl: activeUrl || iframeSrc,
          sourceUrls: [],
          directM3u8: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    const servers = [];
    const current = await captureCurrentPlayer();
    servers.push({
      label: 'current',
      kind: classifyServer('current'),
      embedId: null,
      ...current,
    });

    for (const option of serverOptions) {
      const tab = page.locator('[data-embed-id]').filter({ hasText: option.label }).first();
      try {
        await tab.click();
        await page.waitForTimeout(1500);
        const capture = await captureCurrentPlayer();
        servers.push({
          label: option.label,
          kind: classifyServer(option.label),
          embedId: option.embedId,
          playableUrl: capture.streamUrl,
          ...capture,
        });
      } catch (error) {
        servers.push({
          label: option.label,
          kind: classifyServer(option.label),
          embedId: option.embedId,
          iframeSrc: await page.locator('iframe').first().getAttribute('src').catch(() => null),
          playableUrl: null,
          streamUrl: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(JSON.stringify({ watchUrl: targetUrl, serverCount: serverOptions.length, servers }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Scrape test failed:');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});