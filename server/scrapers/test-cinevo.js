/**
 * Full server enumeration test for CinevoScraperService v5.
 * Key fix: click combobox AND read options atomically in one page.evaluate()
 * so the portal doesn't close before we can read the options.
 *
 * Run: node server/scrapers/test-cinevo.js
 */

import { chromium } from "playwright";

const BASE_URL = "https://cinevo.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WATCH_URL = `${BASE_URL}/watch/tv/naruto-46260?ep=1`;

const isValidEmbed = (url) => {
  if (!url || url.trim() === "") return false;
  const u = url.toLowerCase();
  return !u.includes("about:blank") && !u.includes("disqus") &&
         !u.includes("google.com") && u.startsWith("http");
};

function inferLang(label) {
  const n = (label || "").toLowerCase();
  if (n.includes("hindi") || n.includes("french") || n.includes("italian") ||
      n.includes("spanish") || n.includes("german") || n.includes("dub")) return "dub";
  return "sub";
}

const getIframeSrc = (page) =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll("iframe")];
    return (
      all.find((f) => f.title && f.src?.startsWith("http"))?.src ||
      all.find((f) => f.src?.startsWith("http"))?.src ||
      null
    );
  });

async function run() {
  console.log("═".repeat(60));
  console.log("  🧪  CINEVO FULL SERVER ENUMERATION TEST v5");
  console.log(`  URL: ${WATCH_URL}`);
  console.log("═".repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    bypassCSP: true,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      DNT: "1",
    },
  });

  const page = await context.newPage();
  await page.addInitScript(() => { try { window.open = () => null; } catch (_) {} });

  // Use domcontentloaded — more reliable than networkidle for SPAs
  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Wait for React to fully hydrate (combobox button appears + iframe loads)
  console.log("\n⏳ Waiting for React hydration...");
  await page.waitForSelector('button[role="combobox"]', { timeout: 20000 });
  await page.waitForTimeout(5000); // allow full client-side hydration

  console.log(`📄 Title: ${await page.title()}`);

  const sources = [];
  const seenUrls = new Set();

  const addSource = (label, url) => {
    if (!isValidEmbed(url) || seenUrls.has(url)) {
      if (url && seenUrls.has(url)) console.log(`  ♻️  "${label}" → duplicate`);
      return false;
    }
    seenUrls.add(url);
    const lang = inferLang(label);
    sources.push({ label, url, lang });
    console.log(`  ✅ "${label}" [${lang}] → ${url}`);
    return true;
  };

  // ── 1. Capture initial iframe ─────────────────────────────────────────────
  const initial = await getIframeSrc(page);
  console.log(`\n🖼️  Initial iframe: ${initial}`);
  addSource("VidCore (default)", initial);

  // ── 2. ATOMIC: Open combobox + read options in one evaluate() ────────────
  // Radix Select renders the [role="option"] portal synchronously on click.
  // If we read options in a separate round-trip, the portal may have closed.
  console.log("\n🎛️  Opening combobox and reading options atomically...");

  const serverOptions = await page.evaluate(() => {
    const btn = document.querySelector('button[role="combobox"]');
    if (!btn) return { error: "No combobox found", options: [] };

    // Fire the full event sequence Radix expects
    btn.focus();
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    btn.dispatchEvent(new MouseEvent("mousedown",     { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("click",         { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, pointerId: 1 }));
    btn.dispatchEvent(new MouseEvent("mouseup",       { bubbles: true, cancelable: true }));

    // Give React a tick to process
    // (This is synchronous in the same evaluate() call — DOM updates happen before return)
    const opts = [...document.querySelectorAll('[role="option"]')];
    return {
      error: null,
      expanded: btn.getAttribute("aria-expanded"),
      state: btn.getAttribute("data-state"),
      options: opts.map((el, idx) => ({
        idx,
        label: el.textContent?.trim().replace(/\s+/g, " ") || `Server ${idx}`,
        checked: el.getAttribute("data-state") === "checked",
        highlighted: el.hasAttribute("data-highlighted"),
      })),
    };
  });

  console.log(`  Combobox expanded=${serverOptions.expanded} state=${serverOptions.state}`);

  if (serverOptions.error) {
    console.log(`  ❌ ${serverOptions.error}`);
  } else if (serverOptions.options.length === 0) {
    // If still 0, try waiting and reading again
    console.log("  ⚠️ 0 options found synchronously — waiting 2s and retrying...");
    await page.waitForTimeout(2000);

    const retryOpts = await page.evaluate(() => {
      return [...document.querySelectorAll('[role="option"][data-radix-collection-item]')].map((el, idx) => ({
        idx,
        label: el.textContent?.trim().replace(/\s+/g, " ") || `Server ${idx}`,
        checked: el.getAttribute("data-state") === "checked",
      }));
    });

    if (retryOpts.length > 0) {
      serverOptions.options = retryOpts;
      console.log(`  ✅ Found ${retryOpts.length} options on retry`);
    } else {
      console.log("  ❌ Still 0 options — taking debug screenshot");
      await page.screenshot({ path: "server/scrapers/cinevo-debug-v5.png", fullPage: false });
      console.log("  📸 Screenshot: server/scrapers/cinevo-debug-v5.png");
    }
  }

  console.log(`\n📋 Server options (${serverOptions.options.length}):`);
  serverOptions.options.forEach((o) =>
    console.log(`  [${o.idx}] "${o.label}" ${o.checked ? "← active" : ""}`)
  );

  // ── 3. Click each unchecked option ────────────────────────────────────────
  console.log("\n🔄 Cycling through all servers...\n");

  for (const opt of serverOptions.options) {
    if (opt.checked) {
      console.log(`  ⏭️  Skip "${opt.label}" (already active)`);
      continue;
    }

    console.log(`  👉 Selecting: "${opt.label}"`);

    // Re-open combobox and click option atomically
    const result = await page.evaluate((optIdx) => {
      // Re-open combobox
      const btn = document.querySelector('button[role="combobox"]');
      if (btn && btn.getAttribute("aria-expanded") !== "true") {
        btn.focus();
        btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
        btn.dispatchEvent(new MouseEvent("mousedown",     { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent("click",         { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, pointerId: 1 }));
      }

      // Small delay for portal to render (we're in sync JS so we spin-wait)
      const t = Date.now();
      while (Date.now() - t < 300) { /* spin */ }

      // Find and click the specific option
      const opts = [...document.querySelectorAll('[role="option"]')];
      const el = opts[optIdx];
      if (!el) return { ok: false, reason: `option ${optIdx} not found (${opts.length} total)` };

      el.focus();
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent("mousedown",     { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("click",         { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent("mouseup",       { bubbles: true, cancelable: true }));

      return { ok: true, label: el.textContent?.trim() };
    }, opt.idx);

    if (!result.ok) {
      console.log(`    ⚠️  ${result.reason}`);
      continue;
    }

    // Wait for iframe to swap (up to 5s)
    const before = await getIframeSrc(page);
    try {
      await page.waitForFunction(
        (prev) => {
          const all = [...document.querySelectorAll("iframe")];
          const cur = (
            all.find((f) => f.title && f.src?.startsWith("http")) ||
            all.find((f) => f.src?.startsWith("http"))
          )?.src;
          return cur && cur !== prev;
        },
        before,
        { timeout: 5000 }
      );
    } catch (_) { /* iframe may stay same for some servers */ }

    await page.waitForTimeout(800);
    const src = await getIframeSrc(page);
    console.log(`    → iframe: ${src || "(none)"}`);
    addSource(opt.label, src);
  }

  // ── 4. ⚡ Cinevo Flash tab ────────────────────────────────────────────────
  console.log("\n⚡ Switching to Cinevo Flash tab...");
  await page.evaluate(() => {
    const btn = document.querySelector(
      '[id*="trigger-cinevo"], button[aria-controls*="content-cinevo"]'
    );
    if (btn) {
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(3500);
  const flashSrc = await getIframeSrc(page);
  console.log(`  → iframe: ${flashSrc || "(none)"}`);
  addSource("Cinevo Flash", flashSrc);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  📊  RESULTS — ${sources.length} unique server(s)`);
  console.log("═".repeat(60));
  sources.forEach((s, i) =>
    console.log(`  [${i + 1}] [${s.lang}] "${s.label}"\n        ${s.url}`)
  );

  const passed = sources.length >= 2;
  console.log(`\n${passed ? "🎉 PASSED" : "❌ FAILED"}`);

  await browser.close();
  process.exit(passed ? 0 : 1);
}

run().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
