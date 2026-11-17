import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const robots = fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
const sitemap = fs.readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const canonical = 'https://www.countryflagbattle.xyz/';
const checks = {
  validDoctype: /^<!DOCTYPE html>/i.test(html),
  oneH1: (html.match(/<h1\b/gi) || []).length === 1,
  canonical: html.includes(`<link rel="canonical" href="${canonical}">`),
  noMetaKeywords: !html.includes('name="keywords"'),
  validJsonLd: (() => { const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i); if (!match) return false; try { JSON.parse(match[1]); return true; } catch { return false; } })(),
  sitemapCanonical: sitemap.includes(`<loc>${canonical}</loc>`),
  robotsCanonical: robots.includes(`Sitemap: ${canonical}sitemap.xml`),
  noSpaCatchAll: !JSON.stringify(config.rewrites || []).includes('destination":"/index.html'),
  aliasRedirect: (config.redirects || []).some(rule => JSON.stringify(rule).includes('countryflagbattlegame.vercel.app') && rule.permanent === true),
  privateNoindex: (config.headers || []).filter(rule => /admin|api/.test(rule.source)).some(rule => JSON.stringify(rule).includes('noindex'))
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({ checks, passed: Object.keys(checks).length - failed.length, total: Object.keys(checks).length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
