import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('https://www.patientlensai.com/', { waitUntil: 'load' });
  
  const overlappingElements = await page.evaluate(() => {
    const header = document.querySelector("header") || document.querySelector("nav") || document.body;
    const elements = Array.from(header.querySelectorAll("a, button, img, svg, h1, h2, h3, p")).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 300;
    });

    const overlaps: string[] = [];

    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const el1 = elements[i];
        const el2 = elements[j];
        
        if (el1.contains(el2) || el2.contains(el1)) continue;

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
            overlaps.push(`"${(el1.textContent?.trim() || el1.tagName).substring(0, 15)}" (${el1.tagName.toLowerCase()}) overlaps "${(el2.textContent?.trim() || el2.tagName).substring(0, 15)}" (${el2.tagName.toLowerCase()}) - w:${overlapWidth}, h:${overlapHeight}`);
          }
        }
      }
    }
    return Array.from(new Set(overlaps));
  });

  console.log("Overlaps:", overlappingElements);
  await browser.close();
})();