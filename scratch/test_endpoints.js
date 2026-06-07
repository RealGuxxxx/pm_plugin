const http = require('http');

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, res => {
      let responseBody = '';
      res.on('data', chunk => {
        responseBody += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve(responseBody);
        }
      });
    });

    req.on('error', err => {
      reject(err);
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- Testing /twitter_signals?query=Polymarket ---');
  try {
    const twitterResult = await getJson('http://localhost:3000/twitter_signals?query=Polymarket');
    console.log('Twitter signals result:', JSON.stringify(twitterResult, null, 2));
  } catch (err) {
    console.error('Twitter signals test failed:', err);
  }

  console.log('\n--- Testing /analyze_comments ---');
  try {
    const data = {
      eventTitle: 'Polymarket Test Event',
      commentsText: 'User1: YES is a great deal! I think YES has a 90% chance. User2: No way, the odds are way too high. I am buying NO.'
    };
    const analysisResult = await postJson('http://localhost:3000/analyze_comments', data);
    console.log('Comments analysis result:', JSON.stringify(analysisResult, null, 2));
  } catch (err) {
    console.error('Comments analysis test failed:', err);
  }
}

runTests();
