import { chromium } from 'playwright';

(async () => {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Test Tablet View
  const vp = { width: 768, height: 1024, name: 'Tablet' };
  console.log(`Setting viewport to ${vp.name} (${vp.width}x${vp.height})`);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  
  console.log("Navigating to https://www.patientlensai.com/ ...");
  await page.goto('https://www.patientlensai.com/', { waitUntil: 'load', timeout: 30000 });
  
  // Allow time for animations/rendering
  await page.waitForTimeout(2000);

  console.log("\n--- Running Layout Checks ---\n");

  // 1. Offscreen Elements
  const offscreenElements = await page.evaluate((viewportWidth) => {
    const interactiveElements = document.querySelectorAll(
      "a, button, input, select, textarea, [role='button'], [tabindex]"
    );
    const offscreen: any[] = [];
    
    interactiveElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
         if (rect.left >= viewportWidth || rect.right <= 0) {
            offscreen.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent?.trim() || "").substring(0, 30),
              left: Math.round(rect.left),
              right: Math.round(rect.right)
            });
         }
      }
    });
    return offscreen;
  }, vp.width);
  console.log("🔴 Offscreen Elements:", offscreenElements);

  // 2. Overlapping Elements (Header area)
  const overlappingElements = await page.evaluate(() => {
    // Broaden search to top 150px of page to catch any header div
    const elements = Array.from(document.querySelectorAll("a, button, img, svg, h1, h2, h3, p, span")).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 150;
    });

    const overlaps: any[] = [];

    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const el1 = elements[i];
        const el2 = elements[j];
        
        // Skip if one contains the other
        if (el1.contains(el2) || el2.contains(el1)) continue;
        
        // Skip if they share the same parent and are just inline text (rough check)
        if (el1.parentElement === el2.parentElement && el1.tagName === 'SPAN' && el2.tagName === 'SPAN') continue;

        const r1 = el1.getBoundingClientRect();
        const r2 = el2.getBoundingClientRect();

        const isOverlapping = !(
          r1.right <= r2.left || 
          r1.left >= r2.right || 
          r1.bottom <= r2.top || 
          r1.top >= r2.bottom
        );

        if (isOverlapping) {
          const overlapWidth = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
          const overlapHeight = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
          
          if (overlapWidth > 5 && overlapHeight > 5) {
            overlaps.push({
              el1: `"${(el1.textContent?.trim() || el1.tagName).substring(0, 15)}" (${el1.tagName.toLowerCase()})`,
              el2: `"${(el2.textContent?.trim() || el2.tagName).substring(0, 15)}" (${el2.tagName.toLowerCase()})`,
              overlapWidth: Math.round(overlapWidth),
              overlapHeight: Math.round(overlapHeight)
            });
          }
        }
      }
    }
    return overlaps;
  });
  console.log("\n🟡 Overlapping Elements (Top 150px):", overlappingElements.slice(0, 10));

  // 3. Uncentered Modals (like cookie banner)
  const uncenteredModals = await page.evaluate((viewportWidth) => {
    const floatingElements = document.querySelectorAll("div, dialog, section");
    const uncentered: any[] = [];
    
    floatingElements.forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 100 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
          const leftGap = rect.left;
          const rightGap = viewportWidth - rect.right;
          
          if (Math.abs(leftGap - rightGap) > 10 && leftGap > 0 && rightGap > 0) {
            if (rect.width < viewportWidth - 20) {
              uncentered.push({
                class: typeof el.className === 'string' ? el.className : '',
                leftGap: Math.round(leftGap),
                rightGap: Math.round(rightGap),
                width: Math.round(rect.width)
              });
            }
          }
        }
      }
    });
    return uncentered;
  }, vp.width);
  console.log("\n🟡 Uncentered Modals:", uncenteredModals);
  
  // 4. Horizontal Overflow Culprits
  const hasHorizontalOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log("\n🔴 Has Horizontal Overflow:", hasHorizontalOverflow);
  
  if (hasHorizontalOverflow) {
      const culprits = await page.evaluate((viewportWidth) => {
          const elements = document.body.querySelectorAll("*");
          const res: any[] = [];
          elements.forEach((el) => {
             const rect = el.getBoundingClientRect();
             if (rect.width > viewportWidth) {
                res.push({
                   tag: el.tagName.toLowerCase(),
                   class: typeof el.className === 'string' ? el.className.split(' ')[0] : '',
                   width: Math.round(rect.width)
                });
             }
          });
          return res.slice(0, 5);
      }, vp.width);
      console.log("   Culprits:", culprits);
  }

  await browser.close();
  console.log("\nDone.");
})();