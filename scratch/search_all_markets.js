async function searchAll() {
  const queries = [
    'https://gamma-api.polymarket.com/markets?q=Iran',
    'https://gamma-api.polymarket.com/markets?query=Iran',
    'https://gamma-api.polymarket.com/events?q=Iran',
    'https://gamma-api.polymarket.com/events?query=Iran'
  ];

  for (const url of queries) {
    console.log(`\nTesting URL: ${url}`);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`  Failed with status ${res.status}`);
        continue;
      }
      const data = await res.json();
      console.log(`  Returned ${Array.isArray(data) ? data.length : (data.results ? data.results.length : 'non-array')} items.`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`  Sample title: "${data[0].question || data[0].title}"`);
        console.log(`  Sample slug: "${data[0].slug}"`);
      } else if (data && data.results && data.results.length > 0) {
        console.log(`  Sample title: "${data.results[0].question || data.results[0].title}"`);
        console.log(`  Sample slug: "${data.results[0].slug}"`);
      }
    } catch (e) {
      console.error(`  Error:`, e.message);
    }
  }
}

searchAll();
