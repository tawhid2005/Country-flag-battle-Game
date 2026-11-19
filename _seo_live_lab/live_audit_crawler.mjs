async function searchWeb(q) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    const html = await res.text();
    // Parse links and snippets
    const matches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    const urlMatches = [...html.matchAll(/class="result__url"[^>]*href="([^"]+)"/g)];
    const titleMatches = [...html.matchAll(/class="result__title"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g)];
    
    console.log('=== SEARCH QUERY: ' + q + ' ===');
    for (let i = 0; i < Math.min(5, urlMatches.length); i++) {
      const u = urlMatches[i] ? urlMatches[i][1].trim() : '';
      const t = titleMatches[i] ? titleMatches[i][1].replace(/<[^>]+>/g, '').trim() : '';
      const s = matches[i] ? matches[i][1].replace(/<[^>]+>/g, '').trim() : '';
      console.log(`${i + 1}. TITLE: ${t}`);
      console.log(`   URL:   ${u}`);
      console.log(`   SNIP:  ${s}\n`);
    }
  } catch (err) {
    console.error('Error fetching:', err.message);
  }
}

async function run() {
  await searchWeb('country flag battle into the circle game');
  await searchWeb('country marble race stream run online');
  await searchWeb('flag battle random marbles');
}
run();
