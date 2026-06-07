async function findSlugs() {
  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?search=peace&active=true');
    if (!res.ok) {
      console.log('API returned status:', res.status);
      return;
    }
    const data = await res.json();
    console.log(`Found ${data.length} markets for "peace":`);
    data.forEach(m => {
      console.log(`- Market Title: "${m.question}"`);
      console.log(`  Slug: "${m.slug}"`);
      if (m.events && m.events.length > 0) {
        console.log(`  Event Slug: "${m.events[0].slug}"`);
      }
    });
  } catch (err) {
    console.error('Failed to search slugs:', err);
  }
}

findSlugs();
