import { chromium } from "playwright";

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://tec-edu-website-v2.vercel.app/", { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(2000);
  const html = await page.content();
  console.log("Length:", html.length);
  console.log("Links:", html.match(/href="[^"]+"/g)?.length);
  await browser.close();
}
test();
