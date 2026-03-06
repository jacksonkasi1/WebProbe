import { analyzeResponsiveLiveBatch } from '../src/analyzers/responsive.ts';

async function run() {
  const urls = [
    'https://www.patientlensai.com/'
  ];
  
  const viewports = [
    { name: "Mobile", width: 375, height: 812 },
    { name: "Tablet", width: 768, height: 1024 },
  ];

  console.log("Starting batch test...");
  const start = Date.now();
  
  const issues = await analyzeResponsiveLiveBatch(urls, viewports, (url) => {
    console.log(`Processing: ${url}`);
  });
  
  console.log(`Finished in ${Date.now() - start}ms`);
  
  console.log("Issues found:", issues.length);
  for (const issue of issues) {
    if (issue.id.includes('uncentered') || issue.id.includes('offscreen') || issue.id.includes('overflow')) {
      console.log(`- [${issue.severity}] ${issue.title} on ${issue.url}`);
      console.log(`  ${issue.actual}`);
    }
  }
}

run().catch(console.error);