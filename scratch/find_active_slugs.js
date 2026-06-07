async function searchActiveEvents() {
  try {
    const res = await fetch('https://gamma-api.polymarket.com/events?active=true&limit=100');
    if (!res.ok) {
      console.log('Failed to fetch active events:', res.status);
      return;
    }
    const data = await res.json();
    console.log(`Fetched ${data.length} active events.`);
    const matches = data.filter(e => {
      const title = (e.title || '').toLowerCase();
      const desc = (e.description || '').toLowerCase();
      return title.includes('iran') || title.includes('peace') || desc.includes('iran') || desc.includes('peace');
    });

    console.log(`Found ${matches.length} matching events:`);
    matches.forEach(e => {
      console.log(`- Event: "${e.title}"`);
      console.log(`  Slug: "${e.slug}"`);
    });
  } catch (err) {
    console.error('Failed to search active events:', err);
  }
}

searchActiveEvents();
