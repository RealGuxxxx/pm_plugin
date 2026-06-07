async function test() {
  const slug = 'new-rhianna-album-before-gta-vi-926'; // From search result
  try {
    // Attempt 1: Query by slug parameter
    const res1 = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
    const data1 = await res1.json();
    console.log("Query by slug parameter status:", res1.status);
    console.log("Query by slug parameter data length:", data1.length);
    if (data1.length > 0) {
      console.log("Market question:", data1[0].question);
      console.log("Market prices:", data1[0].outcomePrices);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
