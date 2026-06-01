/**
 * Cinevo combobox server inspector.
 * Opens the "VidCore" combobox dropdown and enumerates every server option.
 * Run: node server/scrapers/test-cinevo-combobox.js
 */

import { chromium } from "playwright";

const BASE_URL = "https://cinevo.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WATCH_URL = `${BASE_URL}/watch/tv/naruto-46260?ep=1`;

async function inspect() {
  console.log("🔬 CINEVO COMBOBOX SERVER INSPECTOR");
  console.log("=".repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    bypassCSP: true,
    javaScriptEnabled: true,
  });

  const page = await context.newPage();

  // Track all iframe changes
  const iframeChanges = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (res.status() === 200 && (url.includes("/api/") || url.includes("embed") || url.includes("source"))) {
      try {
        const ct = res.headers()["content-type"] || "";
        if (ct.includes("json")) {
          const json = await res.json().catch(() => null);
          if (json) console.log("📡 API Response:", url, "→", JSON.stringify(json).slice(0, 200));
        }
      } catch (_) {}
    }
  });

  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(4000);

  console.log("\n📄 Page ready:", await page.title());

  // ── Helper: get active iframe src ────────────────────────────────────────
  const getIframeSrc = () =>
    page.locator("iframe").first().getAttribute("src").catch(() => null);

  const initial = await getIframeSrc();
  console.log(`\n🖼️  Initial iframe: ${initial}`);

  // ── Step 1: Find the combobox button ─────────────────────────────────────
  const comboboxes = await page.evaluate(() => {
    return [...document.querySelectorAll('button[role="combobox"]')].map((btn, i) => ({
      idx: i,
      text: btn.textContent?.trim(),
      state: btn.getAttribute("data-state"),
      ariaExpanded: btn.getAttribute("aria-expanded"),
      ariaControls: btn.getAttribute("aria-controls"),
      id: btn.id,
    }));
  });
  console.log(`\n🎛️  Comboboxes found: ${comboboxes.length}`);
  comboboxes.forEach((c) => console.log(`  [${c.idx}] "${c.text}" state=${c.state} expanded=${c.ariaExpanded} controls=${c.ariaControls}`));

  if (comboboxes.length === 0) {
    console.log("❌ No comboboxes found — dumping all button roles:");
    const roles = await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => ({
        role: b.getAttribute("role"), text: b.textContent?.trim().slice(0, 40), id: b.id
      })).filter((b) => b.role)
    );
    roles.forEach((r) => console.log(" ", JSON.stringify(r)));
    await browser.close();
    return;
  }

  // ── Step 2: Click the combobox to open it ─────────────────────────────────
  console.log("\n🖱️  Opening combobox via JS dispatchEvent...");
  await page.evaluate((idx) => {
    const combos = [...document.querySelectorAll('button[role="combobox"]')];
    const target = combos[idx];
    if (target) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    }
  }, 0);

  await page.waitForTimeout(1500);

  // Also try Playwright's normal click as fallback
  try {
    await page.locator('button[role="combobox"]').first().click({ force: true, timeout: 3000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log("⚠️  Force click also failed:", e.message.split("\n")[0]);
  }

  // ── Step 3: Read all dropdown options ─────────────────────────────────────
  // Radix Select renders options in a portal (body-level div)
  const portalOptions = await page.evaluate(() => {
    // Radix Select options: [role="option"] or [data-radix-select-item]
    const selectors = [
      '[role="option"]',
      '[data-radix-select-item]',
      '[data-radix-collection-item]:not([role="tab"])',
      '[cmdk-item]',
      '[class*="SelectItem"]',
      '[class*="select-item"]',
      '[class*="DropdownMenu"] [role="menuitem"]',
      '[role="listbox"] [role="option"]',
      '[role="listbox"] li',
    ];
    for (const sel of selectors) {
      const items = [...document.querySelectorAll(sel)];
      if (items.length > 0) {
        return {
          selector: sel,
          items: items.map((el, i) => ({
            idx: i,
            text: el.textContent?.trim().replace(/\s+/g, " "),
            value: el.getAttribute("data-value") || el.getAttribute("value") || "",
            selected: el.getAttribute("aria-selected") === "true" || el.getAttribute("data-state") === "checked",
            dataAttrs: Object.fromEntries(
              [...el.attributes]
                .filter((a) => a.name.startsWith("data-"))
                .map((a) => [a.name, a.value])
            ),
          })),
        };
      }
    }

    // Dump entire body structure to find the portal
    const portals = [...document.querySelectorAll("[data-radix-popper-content-wrapper], [data-radix-portal]")];
    return {
      selector: "portal-search",
      portals: portals.map((p) => p.innerHTML.slice(0, 500)),
      allHiddenDivs: [...document.querySelectorAll("div[role='listbox'], div[role='menu']")]
        .map((d) => ({ role: d.getAttribute("role"), html: d.innerHTML.slice(0, 300) })),
    };
  });

  console.log(`\n📋 Dropdown options (selector="${portalOptions.selector}"):`);
  if (portalOptions.items) {
    portalOptions.items.forEach((opt) =>
      console.log(`  [${opt.idx}] "${opt.text}" value="${opt.value}" selected=${opt.selected}`, JSON.stringify(opt.dataAttrs))
    );
  } else {
    console.log("  ❌ No items found via any selector");
    console.log("  Portals:", JSON.stringify(portalOptions.portals));
    console.log("  Listboxes:", JSON.stringify(portalOptions.allHiddenDivs));
  }

  // ── Step 4: Also check if the combobox changed its DOM state ──────────────
  const comboboxState = await page.evaluate(() => {
    const btn = document.querySelector('button[role="combobox"]');
    return {
      state: btn?.getAttribute("data-state"),
      expanded: btn?.getAttribute("aria-expanded"),
      text: btn?.textContent?.trim(),
    };
  });
  console.log("\n🎛️  Combobox state after click:", comboboxState);

  // ── Step 5: Take a screenshot to visually inspect what's rendered ─────────
  await page.screenshot({ path: "server/scrapers/cinevo-debug.png", fullPage: false });
  console.log("\n📸 Screenshot saved: server/scrapers/cinevo-debug.png");

  // ── Step 6: Try Cinevo Flash tab and inspect its panel ────────────────────
  console.log("\n🔄 Clicking Cinevo Flash tab...");
  await page.evaluate(() => {
    const flashBtn = document.querySelector('#radix-\\:rc\\:-trigger-cinevo, [id*="trigger-cinevo"]');
    if (flashBtn) {
      flashBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(3000);

  const flashPanel = await page.evaluate(() => {
    const panel = document.querySelector('#radix-\\:rc\\:-content-cinevo, [id*="content-cinevo"]');
    return {
      state: panel?.getAttribute("data-state"),
      html: panel?.innerHTML?.slice(0, 1000),
      text: panel?.textContent?.trim().slice(0, 200),
    };
  });
  console.log("\n⚡ Cinevo Flash panel after click:");
  console.log("  state:", flashPanel.state);
  console.log("  text:", flashPanel.text);
  console.log("  html:", flashPanel.html);

  const afterFlashIframe = await getIframeSrc();
  console.log("\n🖼️  Iframe after Flash tab click:", afterFlashIframe);

  // ── Step 7: Dump all iframes in DOM including hidden ones ─────────────────
  const allIframesDeep = await page.evaluate(() =>
    [...document.querySelectorAll("iframe")].map((f) => ({
      src: f.src,
      title: f.title,
      hidden: f.hidden || f.style.display === "none",
      id: f.id,
    }))
  );
  console.log(`\n🖼️  ALL iframes in DOM (${allIframesDeep.length}):`);
  allIframesDeep.forEach((f, i) =>
    console.log(`  [${i + 1}] src="${f.src}" title="${f.title}" hidden=${f.hidden}`)
  );

  // ── Step 8: Wait longer and retry getting combobox options ────────────────
  // Close & reopen the combobox after Flash tab
  console.log("\n🔄 Re-switching to Standard Servers tab...");
  await page.evaluate(() => {
    const stdBtn = document.querySelector('#radix-\\:rc\\:-trigger-iframe, [id*="trigger-iframe"]');
    if (stdBtn) stdBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(2000);

  console.log("\n🖱️  Opening combobox a second time with keyboard trigger...");
  const combobox = page.locator('button[role="combobox"]').first();
  try {
    await combobox.focus({ timeout: 3000 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);
    
    // Look for listbox after keyboard open
    const listbox = await page.locator('[role="listbox"]').first().isVisible().catch(() => false);
    console.log("Listbox visible after keyboard Enter:", listbox);
    
    const kbOptions = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"], [role="listbox"] li, [data-radix-select-item]')]
        .map((el) => el.textContent?.trim().replace(/\s+/g, " "))
        .filter(Boolean)
    );
    console.log(`Keyboard-triggered options (${kbOptions.length}):`, kbOptions);
  } catch (e) {
    console.log("⚠️  Keyboard approach failed:", e.message.split("\n")[0]);
  }

  // Take another screenshot after interaction
  await page.screenshot({ path: "server/scrapers/cinevo-debug2.png", fullPage: false });
  console.log("📸 Screenshot 2 saved: server/scrapers/cinevo-debug2.png");

  await browser.close();
  console.log("\n✅ Done.");
}

inspect().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
