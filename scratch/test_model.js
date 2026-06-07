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

async function testModels() {
  const models = [
    'google/gemini-2.5-flash',
    'deepseek/deepseek-r1-distill-llama-70b',
    'openai/gpt-4o-mini'
  ];

  for (const model of models) {
    console.log(`\n--- Testing model: ${model} ---`);
    try {
      const escapedInput = JSON.stringify({
        messages: [{ role: 'user', content: '你好，请用中文说"今天天气很好"' }],
        model: model
      });
      const command = "npx xapi-to call ai.text.chat.fast --input '" + escapedInput.replace(/'/g, "'\\''") + "'";
      const stdout = await runCommand(command);
      const parsed = JSON.parse(stdout);
      console.log('Full parsed output:', JSON.stringify(parsed, null, 2));
    } catch (err) {
      console.error(`Failed for model ${model}:`, err.message);
    }
  }
}

testModels();
