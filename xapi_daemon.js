/* Polymarket AI Agent Extension: xapi Local Bridge Daemon */

const http = require('http');
const url = require('url');
const { exec } = require('child_process');

const PORT = 3000;

// Execute terminal command helper returning promise
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

// Parse request body for POST requests
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', err => {
      reject(err);
    });
  });
}

// Generate fallback mock data for general web signals (news)
function getFallbackSignals(query) {
  const score = Math.floor(45 + Math.random() * 35);
  
  return {
    sentimentScore: score,
    signals: [
      {
        source: 'News',
        impact: score > 60 ? 'Bullish' : 'Neutral',
        content: `Polymarket trading volume surges for "${query}" as negotiations enter a critical phase. Analysts debate the likelihood of the final outcome.`,
        time: 'Just now'
      },
      {
        source: 'Twitter',
        impact: 'Neutral',
        content: `Debate intensifies on X regarding the timeline of "${query}". Traders are bidding up YES contracts on short-term price momentum.`,
        time: '15m ago'
      },
      {
        source: 'Twitter',
        impact: score > 65 ? 'Bullish' : 'Bearish',
        content: `Prominent betting accounts highlight changing odds on "${query}" after recent official statements. Opinion remains highly divided.`,
        time: '1h ago'
      }
    ]
  };
}

// Generate fallback mock data for Twitter timeline topics
function getFallbackTwitterSignals(query) {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('iran') || lowerQuery.includes('peace') || lowerQuery.includes('停火') || lowerQuery.includes('和平')) {
    return {
      success: true,
      tweets: [
        {
          author: "Intellinews (@Intellinews)",
          impact: "Bullish",
          content: "Geneva leak: Draft framework for US-Iran permanent peace treaty has been agreed in principle. Major steps on oil sanctions relief scheduled for Q4.",
          time: "5m ago"
        },
        {
          author: "Middle East Observer (@MiddleEastObserver)",
          impact: "Bearish",
          content: "Skepticism grows on X as conservative groups in Tehran protest against the nuclear inspection clauses. Peace deal might drag on beyond June 30.",
          time: "17m ago"
        },
        {
          author: "Geopolitics Today (@GeopoliticsToday)",
          impact: "Bullish",
          content: "Polymarket YES odds surge to 65% as traders react to positive State Department press briefing regarding Iran security agreements.",
          time: "42m ago"
        },
        {
          author: "Alpha Alerts (@AlphaAlerts)",
          impact: "Neutral",
          content: "Traders debate short-term Iran peace contracts. Watch for Trump's upcoming rally speech for potential comments that could swing the odds.",
          time: "1h ago"
        }
      ]
    };
  }
  
  return {
    success: true,
    tweets: [
      {
        author: "Market Whales (@WhaleAlerts)",
        impact: "Bullish",
        content: `Huge volume spike on Polymarket for "${query}". Big money accounts are loading up on YES contracts.`,
        time: "2m ago"
      },
      {
        author: "Sentiment Sentinel (@SentimentSentinel)",
        impact: "Bearish",
        content: `Social sentiment on X for "${query}" is turning cautious. Users are noting delay risks in official filings.`,
        time: "15m ago"
      },
      {
        author: "Polymarket Stats (@PM_Stats)",
        impact: "Neutral",
        content: `Trading volume for "${query}" reaches $2.5M. Consensus still forming.`,
        time: "48m ago"
      },
      {
        author: "Speculator Pro (@SpeculatorPro)",
        impact: "Bullish",
        content: `YES options represent strong risk-reward ratio here. Easing macro conditions should push the resolution forward.`,
        time: "2h ago"
      }
    ]
  };
}

// Process news results from xapi search
function processNewsResults(query, newsJson) {
  try {
    const data = JSON.parse(newsJson);
    if (data.success === false) {
      return {
        success: false,
        error: data.error || { message: 'xapi news search failed' }
      };
    }
    const results = data.results || data;
    
    if (!Array.isArray(results) || results.length === 0) {
      return {
        success: true,
        sentimentScore: 50,
        signals: []
      };
    }
    
    const signals = results.slice(0, 4).map((item, idx) => {
      const title = (item.title || '').toLowerCase();
      const snippet = (item.snippet || '').toLowerCase();
      
      let impact = 'Neutral';
      if (title.includes('agree') || title.includes('success') || title.includes('positive') || snippet.includes('peace')) {
        impact = 'Bullish';
      } else if (title.includes('fail') || title.includes('reject') || title.includes('stall') || snippet.includes('clash')) {
        impact = 'Bearish';
      }
      
      return {
        source: 'News',
        impact,
        content: item.title + ' - ' + (item.snippet || item.description || '').substring(0, 120) + '...',
        time: idx === 0 ? '5m ago' : `${idx * 15}m ago`
      };
    });
    
    let score = 50;
    signals.forEach(s => {
      if (s.impact === 'Bullish') score += 12;
      if (s.impact === 'Bearish') score -= 12;
    });
    
    return {
      sentimentScore: Math.max(10, Math.min(90, score)),
      signals
    };
  } catch (err) {
    console.error('Error parsing news json, using fallback:', err);
    return getFallbackSignals(query);
  }
}

// Process twitter results from xapi search
function processTwitterResults(query, twitterJson) {
  try {
    const parsed = JSON.parse(twitterJson);
    if (parsed.success === false) {
      return {
        success: false,
        error: parsed.error || { message: 'xapi search failed' }
      };
    }
    const tweets = parsed.data?.tweets || parsed.tweets || parsed.results || [];
    
    const processed = tweets.slice(0, 4).map((t, idx) => {
      const text = t.text || t.full_text || '';
      const handle = t.user?.screen_name ? `@${t.user.screen_name}` : '@TwitterUser';
      const name = t.user?.name || 'Twitter User';
      
      const lower = text.toLowerCase();
      let impact = 'Neutral';
      if (lower.includes('yes') || lower.includes('bullish') || lower.includes('agree') || lower.includes('buy') || lower.includes('peace') || lower.includes('success')) {
        impact = 'Bullish';
      } else if (lower.includes('no') || lower.includes('bearish') || lower.includes('reject') || lower.includes('fail') || lower.includes('sell') || lower.includes('skeptical')) {
        impact = 'Bearish';
      }
      
      let timeStr = 'Just now';
      if (t.created_at) {
        try {
          const diffMs = Date.now() - new Date(t.created_at).getTime();
          const diffMins = Math.floor(diffMs / 60000);
          if (diffMins < 60) {
            timeStr = diffMins <= 0 ? 'Just now' : `${diffMins}m ago`;
          } else {
            const diffHrs = Math.floor(diffMins / 60);
            if (diffHrs < 24) timeStr = `${diffHrs}h ago`;
            else timeStr = `${Math.floor(diffHrs/24)}d ago`;
          }
        } catch(e) {
          timeStr = 'Recent';
        }
      }
      
      return {
        author: `${name} (${handle})`,
        impact,
        content: text,
        time: timeStr
      };
    });
    
    return {
      success: true,
      tweets: processed
    };
  } catch (err) {
    console.error('Error parsing twitter results:', err);
    return {
      success: false,
      error: { message: err.message }
    };
  }
}

// Simulate Goose fallback when CLI is not installed
function simulateGooseFallback(prompt, marketTitle) {
  const lower = prompt.toLowerCase();
  const isTrade = lower.includes('buy') || lower.includes('sell') || lower.includes('买') || lower.includes('卖');
  
  if (isTrade) {
    let type = 'BUY';
    if (lower.includes('sell') || lower.includes('卖')) type = 'SELL';
    
    let outcome = 'YES';
    if (lower.includes('no') || lower.includes('否')) outcome = 'NO';
    
    let amountUSDC = 5;
    const amountMatch = prompt.match(/(\d+(?:\.\d+)?)/);
    if (amountMatch) amountUSDC = parseFloat(amountMatch[1]);
    
    let priceType = 'MARKET';
    let limitPrice = null;
    const priceMatch = prompt.match(/(?:at|under|below|limit|限价|价格|价格在|低于|在)\s*(\d+(?:\.\d+)?)/i);
    if (priceMatch) {
      limitPrice = parseFloat(priceMatch[1]);
      priceType = 'LIMIT';
    }
    
    const orderJson = {
      type,
      outcome,
      amountUSDC,
      priceType,
      limitPrice
    };
    
    return `我已使用 Goose 离线引擎为您解析您的交易指令。
我将协助您在 "${marketTitle}" 市场中以 ${priceType === 'LIMIT' ? `限价 $${limitPrice}` : '市价'} ${type === 'BUY' ? '买入' : '卖出'} ${outcome} 合约。

\`\`\`json
${JSON.stringify(orderJson, null, 2)}
\`\`\``;
  }
  
  return `您好！我是集成在系统中的 Goose AI 助手。目前我正在以本地离线模式运行。
关于您问的 "${prompt}"，您可以要求我：
1. **分析当前市场趋势**：我会利用 xapi 监测社交舆论。
2. **模拟下单交易**：支持买入/卖出 YES 或 NO，例如输入 "买 10 usdc 的 yes"。

在您本地配置完成 \`goose configure\` 后，我将升级为支持自主代码执行和文件操作的完全体 Agent。`;
}

// Decodes GPT BPE Unicode tokens back to standard UTF-8 string
function decodeBpeUnicode(str) {
  if (typeof str !== 'string') return str;
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    let b = c;
    if (c >= 256) {
      if (c >= 256 && c <= 288) {
        b = c - 256;
      } else if (c >= 289 && c <= 322) {
        b = c - 289 + 127;
      } else if (c === 323) {
        b = 173;
      }
    }
    bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

// Translate tweets to Chinese in batch using xapi AI
async function translateTweetsToChinese(tweets) {
  if (!tweets || tweets.length === 0) return tweets;

  const systemPrompt = `You are a professional translator. Translate the following list of English tweets/comments into clear, natural Chinese.
Your output must be a valid JSON array of strings containing ONLY the translated text in the exact same order.
Do not include any other text, markdown wrapper (like \`\`\`json), or explanations.
Example input:
["hello", "world"]
Example output:
["你好", "世界"]`;

  const inputTexts = tweets.map(t => t.content);
  const userPrompt = JSON.stringify(inputTexts);

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    const escapedInput = JSON.stringify({
      messages,
      model: 'deepseek/deepseek-r1-distill-qwen-32b'
    });
    const command = "npx xapi-to call ai.text.chat.fast --input '" + escapedInput.replace(/'/g, "'\\''") + "'";
    console.log(`[xapi Daemon] Translating tweets with command: ${command}`);
    const stdout = await runCommand(command);
    const parsed = JSON.parse(stdout);
    if (parsed.success === false) {
      throw new Error(parsed.error?.message || 'xapi translation failed');
    }
    const aiTextRaw = parsed.data?.choices?.[0]?.message?.content || parsed.choices?.[0]?.message?.content || parsed.response || '';
    if (!aiTextRaw) {
      throw new Error('No translation content returned');
    }
    const aiText = decodeBpeUnicode(aiTextRaw).trim();

    // Parse the output array
    let cleanJson = aiText;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    const translatedArray = JSON.parse(cleanJson);
    if (Array.isArray(translatedArray) && translatedArray.length === tweets.length) {
      tweets.forEach((tweet, idx) => {
        tweet.content = translatedArray[idx] || tweet.content;
      });
      console.log(`[xapi Daemon] Successfully translated ${tweets.length} tweets.`);
    } else {
      console.warn(`[xapi Daemon] Translation array mismatch: expected ${tweets.length}, got ${translatedArray?.length}`);
    }
  } catch (err) {
    console.warn('[xapi Daemon] Tweet translation failed, keeping original English:', err.message);
  }
  return tweets;
}

// Server Definition
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  
  // GET: Health Check
  if (parsedUrl.pathname === '/ping' || parsedUrl.pathname === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, status: 'ok', message: 'xapi Daemon Online' }));
    return;
  }
  
  // GET: Fetch General News/Signals
  if (parsedUrl.pathname === '/signals' && req.method === 'GET') {
    const query = parsedUrl.query.query || 'Polymarket';
    console.log(`[xapi Daemon] Received general signals query request: "${query}"`);

    try {
      const escapedInput = JSON.stringify({ q: query });
      const command = `npx xapi-to call web.search.news --input '${escapedInput.replace(/'/g, "'\\''")}'`;
      
      console.log(`[xapi Daemon] Running command: ${command}`);
      const stdout = await runCommand(command);
      
      const processed = processNewsResults(query, stdout);
      res.writeHead(200);
      res.end(JSON.stringify(processed));
    } catch (error) {
      console.warn(`[xapi Daemon] News CLI call failed (${error.message}).`);
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: { message: error.message } }));
    }
  } 
  
  // GET: Fetch Twitter Signals
  else if (parsedUrl.pathname === '/twitter_signals' && req.method === 'GET') {
    const query = parsedUrl.query.query || 'Polymarket';
    console.log(`[xapi Daemon] Received Twitter signals query request: "${query}"`);
    try {
      const escapedInput = JSON.stringify({ raw_query: query, sort_by: 'Latest', provider: 'twitter' });
      const command = "npx xapi-to call twitter.search --input '" + escapedInput.replace(/'/g, "'\\''") + "'";
      console.log(`[xapi Daemon] Running Twitter command: ${command}`);
      const stdout = await runCommand(command);
      const processed = processTwitterResults(query, stdout);
      if (processed.success && processed.tweets) {
        processed.tweets = await translateTweetsToChinese(processed.tweets);
      }
      res.writeHead(200);
      res.end(JSON.stringify(processed));
    } catch (error) {
      console.warn(`[xapi Daemon] Twitter CLI call failed (${error.message}).`);
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: { message: error.message } }));
    }
  }

  // POST: Analyze Comments via Goose (Local AI)
  else if (parsedUrl.pathname === '/analyze_comments' && req.method === 'POST') {
    let data;
    try {
      data = await parseRequestBody(req);
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
      return;
    }

    const commentsText = data.commentsText || '';
    const eventTitle = data.eventTitle || '';
    if (!commentsText) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing commentsText parameter' }));
      return;
    }

    const systemPrompt = `You are a Polymarket sentiment analyst. Your task is to analyze user comments from a prediction market event. Summarize:
1. Overall market sentiment (Bullish/Bearish on YES outcome) in percentage estimation (e.g., 70% bullish, 30% bearish).
2. Key arguments, debates, and points of agreement/disagreement among traders.
3. Notable positions or actions stated by commenters.
Output the analysis in clean Chinese using markdown headers and bullet points. Do not include markdown code block wrappers (e.g. \`\`\`markdown).`;

    const userPrompt = `Analyze the following user comments for Polymarket event "${eventTitle}":\n\n${commentsText}`;

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];
      const escapedInput = JSON.stringify({
        messages,
        model: 'deepseek/deepseek-r1-distill-qwen-32b'
      });
      const command = "npx xapi-to call ai.text.chat.fast --input '" + escapedInput.replace(/'/g, "'\\''") + "'";
      console.log(`[xapi Daemon] Running Comments Analysis AI command: ${command}`);
      const stdout = await runCommand(command);
      
      const parsed = JSON.parse(stdout);
      if (parsed.success === false) {
        throw new Error(parsed.error?.message || 'xapi AI call failed');
      }
      
      const analysisTextRaw = parsed.data?.choices?.[0]?.message?.content || parsed.choices?.[0]?.message?.content || parsed.response || '';
      if (!analysisTextRaw) {
        throw new Error('No analysis content returned from xapi');
      }
      const analysisText = decodeBpeUnicode(analysisTextRaw).trim();

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, analysis: analysisText }));
    } catch (error) {
      console.error(`[xapi Daemon] Local comments analysis failed:`, error);
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: { message: error.message } }));
    }
  }

  // POST: Execute Goose Agent Chat Session
  else if (parsedUrl.pathname === '/goose_chat' && req.method === 'POST') {
    let data;
    try {
      data = await parseRequestBody(req);
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
      return;
    }

    const prompt = data.prompt || '';
    const marketTitle = data.marketTitle || 'this market';
    const currentPricesText = data.currentPricesText || '';
    
    console.log(`[xapi Daemon] Received Goose Chat prompt: "${prompt}"`);
    
    if (!prompt) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing prompt parameter' }));
      return;
    }

    // Build system prompt injects
    let systemPrompt = `You are a Polymarket trading assistant. Your active market topic is "${marketTitle}".`;
    if (currentPricesText) {
      systemPrompt += `\nReal-time Market Prices: ${currentPricesText}`;
    }
    systemPrompt += `\nIf the user prompt is a trade instruction (e.g. buying or selling YES/NO outcome contracts), you must parse their intent and append a structured JSON block wrapped in triple backticks at the very end of your response:
\`\`\`json
{
  "type": "BUY" or "SELL",
  "outcome": "YES" or "NO",
  "amountUSDC": number (default 5 if unspecified),
  "priceType": "LIMIT" or "MARKET",
  "limitPrice": number (price limit per share, e.g., 0.45) or null (if MARKET)
}
\`\`\`
For non-trade prompts, do not append the JSON block. Explain your reasoning concisely.`;

    try {
      // Escape single quotes for shell execution
      const command = `goose run --text '${prompt.replace(/'/g, "'\\''")}' --system '${systemPrompt.replace(/'/g, "'\\''")}'`;
      console.log(`[xapi Daemon] Executing command: ${command}`);
      
      const stdout = await runCommand(command);
      console.log(`[xapi Daemon] Goose execution completed successfully.`);
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, response: stdout }));
    } catch (error) {
      console.warn(`[xapi Daemon] Goose execution failed (${error.message}). Falling back to local simulation.`);
      
      const fallbackResult = simulateGooseFallback(prompt, marketTitle);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, response: fallbackResult, isFallback: true }));
    }
  }
  
  else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`Polymarket AI Agent xapi Daemon running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`- GET  http://localhost:${PORT}/signals?query=<query>`);
  console.log(`- GET  http://localhost:${PORT}/twitter_signals?query=<query>`);
  console.log(`- POST http://localhost:${PORT}/goose_chat`);
  console.log(`======================================================\n`);
});
