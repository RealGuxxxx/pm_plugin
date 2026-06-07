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

async function testGooseChat() {
  const data = {
    prompt: '6月7日的概率是多少？能不能买？',
    marketTitle: '美国x伊朗永久和平协议相关，6月7日截止',
    currentPricesText: 'YES: 12¢ (12% probability), NO: 88¢ (88% probability).'
  };

  try {
    console.log('Sending request to /goose_chat with pricing context...');
    const result = await postJson('http://localhost:3000/goose_chat', data);
    console.log('Goose Chat response:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Goose Chat test failed:', err);
  }
}

testGooseChat();
