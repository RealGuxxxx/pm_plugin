const { exec } = require('child_process');

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function test() {
  try {
    const query = 'Polymarket';
    const escapedInput = JSON.stringify({ raw_query: query, sort_by: 'Latest', provider: 'twitter' });
    const command = "npx xapi-to call twitter.search --input '" + escapedInput.replace(/'/g, "'\\''") + "'";
    console.log(`Running Twitter command: ${command}`);
    const stdout = await runCommand(command);
    const parsed = JSON.parse(stdout);
    console.log('parsed success:', parsed.success);
    const tweets = parsed.data?.tweets || parsed.tweets || parsed.results || [];
    console.log('Number of tweets returned:', tweets.length);
    if (tweets.length > 0) {
      console.log('Sample tweet user structure:', JSON.stringify(tweets[0].user, null, 2));
      console.log('Sample tweet text:', tweets[0].text || tweets[0].full_text);
    }
  } catch (err) {
    console.error('Test failed:', err);
  }
}

test();
