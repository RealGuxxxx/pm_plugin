/* Polymarket AI Agent Extension Service Worker */

// Parse Base64 secret to Uint8Array
function base64ToUint8Array(base64String) {
  // Normalize URL-safe characters
  const normalized = base64String.replace(/-/g, '+').replace(/_/g, '/');
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Generate URL-safe HMAC-SHA256 signature for Polymarket L2 Auth
async function generateL2Signature(secretBase64, timestamp, method, path, body = '') {
  try {
    const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
    const keyData = base64ToUint8Array(secretBase64);
    
    const cryptoKey = await self.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const encoder = new TextEncoder();
    const messageData = encoder.encode(message);
    const signatureBuffer = await self.crypto.subtle.sign('HMAC', cryptoKey, messageData);

    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const binaryString = hashArray.map(b => String.fromCharCode(b)).join('');
    
    return btoa(binaryString)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''); // URL-safe base64 without padding
  } catch (error) {
    console.error('Error generating signature:', error);
    throw error;
  }
}

// Local parser fallback using comprehensive regex patterns
function parseWithRegex(prompt, marketTitle) {
  const lower = prompt.toLowerCase();
  
  let type = 'BUY';
  let outcome = 'YES';
  let amountUSDC = 5;
  let priceType = 'MARKET';
  let limitPrice = null;

  // 1. Detect Buy vs Sell
  if (lower.includes('sell') || lower.includes('卖') || lower.includes('卖出')) {
    type = 'SELL';
  }

  // 2. Detect Outcome (YES vs NO)
  if (lower.includes('no') || lower.includes('否') || lower.includes('反对') || lower.includes('no shares')) {
    outcome = 'NO';
  }

  // 3. Extract Amount
  const amountMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollar|刀|元|dollars)/i);
  if (amountMatch) {
    amountUSDC = parseFloat(amountMatch[1]);
  } else {
    const rawNumberMatch = prompt.match(/(\d+(?:\.\d+)?)/);
    if (rawNumberMatch) {
      amountUSDC = parseFloat(rawNumberMatch[1]);
    }
  }

  // 4. Extract Limit Price
  const priceMatch = prompt.match(/(?:at|under|below|limit|限价|价格|价格在|低于|在)\s*(\d+(?:\.\d+)?)/i);
  if (priceMatch) {
    limitPrice = parseFloat(priceMatch[1]);
    priceType = 'LIMIT';
  }

  const estPrice = limitPrice || 0.45; // Simulated default price per share
  const estShares = (amountUSDC / estPrice).toFixed(1);

  // Friendly reply text based on language
  const isChinese = /[\u4e00-\u9fa5]/.test(prompt);
  let replyText = '';
  
  const formattedLimitPrice = limitPrice ? parseFloat(limitPrice).toFixed(2) : '';
  if (isChinese) {
    replyText = `我已通过本地解析算法解析您的订单意图：以 ${priceType === 'LIMIT' ? `限价 $${formattedLimitPrice}` : '市价'} ${type === 'BUY' ? '买入' : '卖出'} ${outcome.toUpperCase()}。请在下方卡片中核对并确认：`;
  } else {
    replyText = `I parsed your trading intent: ${type} ${outcome.toUpperCase()} outcome using ${priceType === 'LIMIT' ? `limit price $${formattedLimitPrice}` : 'market price'}. Please confirm details in the card below:`;
  }

  return {
    id: 'ord_' + Math.random().toString(36).substring(2, 11),
    type,
    outcome,
    amountUSDC,
    priceType,
    limitPrice,
    estShares,
    marketTitle,
    replyText
  };
}

// Parse using Gemini API
async function parseWithGemini(prompt, marketTitle, apiKey, currentPricesText = '') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  let systemPrompt = `You are a Polymarket trading assistant. Your task is to parse a user's natural language trading prompt for a prediction market and output a JSON object representing the trading intention.

Market Topic: "${marketTitle}"
Available Outcomes: "YES" or "NO"`;

  if (currentPricesText) {
    systemPrompt += `\nReal-time Market Prices: ${currentPricesText}`;
  }

  systemPrompt += `\n\nThe user prompt may be in English or Chinese.
Extract:
1. "type": "BUY" or "SELL" (default "BUY" if unclear)
2. "outcome": "YES" or "NO"
3. "amountUSDC": number of USDC to invest (default 5 if unspecified)
4. "priceType": "LIMIT" or "MARKET" (if they specify a limit price like "under 0.4" or "at 0.45", it is LIMIT; otherwise MARKET)
5. "limitPrice": number representing the price limit per share (e.g., 0.45). If priceType is MARKET, set to null.
6. "replyText": A short, friendly confirmation message in the user's language (e.g., "我已为您生成交易确认单，请核对。")

Output ONLY a JSON block, nothing else. Do not wrap in markdown tags or extra characters. Example output:
{
  "type": "BUY",
  "outcome": "YES",
  "amountUSDC": 10,
  "priceType": "LIMIT",
  "limitPrice": 0.45,
  "replyText": "..."
}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nUser Prompt: "${prompt}"` }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    
    // Strip code block wrappers if generated
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);
    
    const estPrice = parsed.limitPrice || 0.45;
    const estShares = (parsed.amountUSDC / estPrice).toFixed(1);

    return {
      id: 'ord_' + Math.random().toString(36).substring(2, 11),
      type: parsed.type || 'BUY',
      outcome: parsed.outcome || 'YES',
      amountUSDC: parsed.amountUSDC || 5,
      priceType: parsed.priceType || 'MARKET',
      limitPrice: parsed.limitPrice || null,
      estShares,
      marketTitle,
      replyText: parsed.replyText || 'Please review your order details below:'
    };
  } catch (error) {
    console.error('Gemini parsing error, falling back to local parser:', error);
    return parseWithRegex(prompt, marketTitle);
  }
}

// Parse using Goose via the xapi Daemon
async function parseWithGoose(prompt, marketTitle, serverUrl, currentPricesText = '') {
  const url = `${serverUrl}/goose_chat`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, marketTitle, currentPricesText })
    });

    if (!response.ok) {
      throw new Error(`Goose daemon returned status ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Goose daemon chat failed');
    }

    const text = data.response || '';
    
    // Parse response text to extract JSON order block if exists
    // The JSON block is wrapped in ```json ... ```
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    let parsedOrder = null;
    let cleanReplyText = text;

    if (jsonMatch) {
      try {
        parsedOrder = JSON.parse(jsonMatch[1].trim());
        // Clean the replyText by removing the JSON code block
        cleanReplyText = text.replace(jsonMatch[0], '').trim();
      } catch (e) {
        console.error('Failed to parse JSON block in Goose output:', e);
      }
    }

    if (parsedOrder && parsedOrder.type) {
      const estPrice = parsedOrder.limitPrice || 0.45;
      const estShares = (parsedOrder.amountUSDC / estPrice).toFixed(1);

      return {
        id: 'ord_' + Math.random().toString(36).substring(2, 11),
        type: parsedOrder.type || 'BUY',
        outcome: parsedOrder.outcome || 'YES',
        amountUSDC: parsedOrder.amountUSDC || 5,
        priceType: parsedOrder.priceType || 'MARKET',
        limitPrice: parsedOrder.limitPrice || null,
        estShares,
        marketTitle,
        replyText: cleanReplyText || 'Please review your order details below:'
      };
    } else {
      // It's a general conversational message, no order card should be shown
      return {
        replyText: cleanReplyText
      };
    }
  } catch (error) {
    console.error('Goose parsing error:', error);
    throw error; // Let caller fall back to Gemini or Regex
  }
}

// Parse using Hunyuan API (hy3-preview)
async function parseWithHunyuan(prompt, marketTitle, apiKey, currentPricesText = '') {
  const url = 'https://tokenhub.tencentmaas.com/v1/chat/completions';
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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'hy3-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Hunyuan API returned status ${response.status}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
      throw new Error('Hunyuan API returned empty choices');
    }
    const text = data.choices[0].message.content.trim();
    
    // Parse response text to extract JSON order block if exists
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    let parsedOrder = null;
    let cleanReplyText = text;

    if (jsonMatch) {
      try {
        parsedOrder = JSON.parse(jsonMatch[1].trim());
        cleanReplyText = text.replace(jsonMatch[0], '').trim();
      } catch (e) {
        console.error('Failed to parse JSON block in Hunyuan output:', e);
      }
    }

    if (parsedOrder && parsedOrder.type) {
      const estPrice = parsedOrder.limitPrice || 0.45;
      const estShares = (parsedOrder.amountUSDC / estPrice).toFixed(1);

      return {
        id: 'ord_' + Math.random().toString(36).substring(2, 11),
        type: parsedOrder.type || 'BUY',
        outcome: parsedOrder.outcome || 'YES',
        amountUSDC: parsedOrder.amountUSDC || 5,
        priceType: parsedOrder.priceType || 'MARKET',
        limitPrice: parsedOrder.limitPrice || null,
        estShares,
        marketTitle,
        replyText: cleanReplyText || 'Please review your order details below:'
      };
    } else {
      return {
        replyText: cleanReplyText
      };
    }
  } catch (error) {
    console.error('Hunyuan parsing error, falling back:', error);
    throw error;
  }
}

// Execute trades via Polymarket CLOB API or simulate
async function executeOrder(order, config) {
  const isSimulation = !config.liveMode || !config.liveAddress || !config.clobKey;

  if (isSimulation) {
    // Simulate order fill after 800ms
    await new Promise(resolve => setTimeout(resolve, 800));
    
    let currentPrice = null;
    if (order.slug) {
      const subOutcome = extractSubOutcomeFromTitle(order.marketTitle);
      currentPrice = await getCurrentPriceFromGamma(order.slug, order.outcome, subOutcome);
    }
    if (currentPrice === null) {
      currentPrice = 0.50;
    }
    
    currentPrice = Math.round(currentPrice * 100) / 100;

    const limitPrice = order.limitPrice ? Math.round(parseFloat(order.limitPrice) * 100) / 100 : null;
    const isLimitOrder = order.priceType === 'LIMIT' && limitPrice !== null;
    
    let isPending = false;
    if (isLimitOrder) {
      if (order.type === 'BUY' && limitPrice < currentPrice) {
        isPending = true;
      } else if (order.type === 'SELL' && limitPrice > currentPrice) {
        isPending = true;
      }
    }

    const avgPrice = isLimitOrder ? limitPrice : currentPrice;
    const shares = (order.amountUSDC / avgPrice).toFixed(1);

    const receipt = {
      id: (isPending ? 'ord_limit_' : 'tx_') + Math.random().toString(36).substring(2, 11),
      marketTitle: order.marketTitle,
      slug: order.slug,
      outcome: order.outcome || 'YES',
      type: order.type || 'BUY',
      priceType: order.priceType || 'MARKET',
      limitPrice: limitPrice,
      shares,
      avgPrice,
      totalSpent: order.amountUSDC,
      isSimulation: true,
      sessionId: order.sessionId,
      timestamp: Date.now()
    };

    if (isPending) {
      await addPendingOrderToStorage(receipt);
      return {
        success: true,
        status: 'pending',
        receipt: receipt
      };
    } else {
      return {
        success: true,
        status: 'filled',
        receipt: receipt
      };
    }
  }

  // Live order placement via Polymarket CLOB API
  // Reference endpoint: POST https://clob.polymarket.com/order
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/order';
  const method = 'POST';
  
  // Note: Standard CLOB API order creation requires order parameters matching Polymarket's contract
  // To construct a real CLOB order, we need:
  // - makerAddress (deposit address)
  // - tokenId (token of asset)
  // - price (in contract formatting)
  // - amount (in contract formatting)
  // - expiration, salt, side, signature
  // For the MVP, we show how L2 Auth headers are wired. If they run live, we construct the request.
  
  const orderBody = {
    owner: config.liveAddress,
    // Simplified order parameters for presentation/API execution
    side: order.type === 'BUY' ? 'BUY' : 'SELL',
    price: parseFloat(order.limitPrice || 0.45),
    amount: parseFloat(order.estShares),
    // Token ID would be resolved dynamically based on YES/NO token map
    tokenId: "0x..." 
  };
  
  const bodyString = JSON.stringify(orderBody);
  
  try {
    const signature = await generateL2Signature(
      config.clobSecret,
      timestamp,
      method,
      path,
      bodyString
    );

    const response = await fetch('https://clob.polymarket.com/order', {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'POLY_ADDRESS': config.liveAddress,
        'POLY_API_KEY': config.clobKey,
        'POLY_PASSPHRASE': config.clobPassphrase,
        'POLY_TIMESTAMP': String(timestamp),
        'POLY_SIGNATURE': signature
      },
      body: bodyString
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Polymarket CLOB API Error: ${errorText}` };
    }

    const receipt = await response.json();
    return {
      success: true,
      receipt: {
        id: receipt.orderID || 'tx_live_' + Date.now(),
        marketTitle: order.marketTitle,
        slug: order.slug,
        outcome: order.outcome || 'YES',
        type: order.type || 'BUY',
        shares: order.estShares,
        avgPrice: order.limitPrice || 0.45,
        totalSpent: order.amountUSDC,
        isSimulation: false
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fetch social signals from xapi Server daemon
async function fetchSignals(marketTitle, serverUrl) {
  try {
    const encodedTitle = encodeURIComponent(marketTitle);
    const response = await fetch(`${serverUrl}/signals?query=${encodedTitle}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) throw new Error('Daemon returned error status');
    return await response.json();
  } catch (error) {
    console.warn('Failed to contact xapi daemon, falling back to mock:', error.message);
    throw error;
  }
}

const activeAnalysisControllers = new Map();

// Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PARSE_ORDER') {
    chrome.storage.local.get(['xapiServer', 'geminiKey', 'hunyuanKey', 'selectedModel'], async (items) => {
      const serverUrl = items.xapiServer || 'http://localhost:3000';
      const apiKey = items.geminiKey;
      const hyKey = items.hunyuanKey || 'sk-sIhWqkQ1LzqsqgXupL2YpmY9dkJcziJxGBGXkL9CkfOW2yLs';
      const selectedModel = items.selectedModel || 'goose';
      
      const combinedTitle = request.marketContext.activeOutcome 
        ? `${request.marketContext.title} (${request.marketContext.activeOutcome})` 
        : request.marketContext.title;

      // Extract real-time prices to provide context for the AI chat
      let currentPricesText = '';
      let yesPrice = null;
      let noPrice = null;

      if (request.marketContext && request.marketContext.domPrices) {
        yesPrice = request.marketContext.domPrices.yes;
        noPrice = request.marketContext.domPrices.no;
      }

      let slug = '';
      if (request.marketContext && request.marketContext.url) {
        try {
          const urlObj = new URL(request.marketContext.url);
          const pathParts = urlObj.pathname.split('/');
          slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
        } catch (e) {
          console.error("Failed to parse URL in PARSE_ORDER:", e);
        }
      }

      if (slug && (yesPrice === null || noPrice === null)) {
        try {
          const targetOutcome = request.marketContext.activeOutcome || '';
          if (yesPrice === null) {
            yesPrice = await getCurrentPriceFromGamma(slug, 'YES', targetOutcome);
          }
          if (noPrice === null) {
            noPrice = await getCurrentPriceFromGamma(slug, 'NO', targetOutcome);
          }
        } catch (e) {
          console.warn("Failed to fetch prices from Gamma for chat context:", e);
        }
      }

      if (yesPrice !== null && noPrice !== null) {
        currentPricesText = `YES: ${(yesPrice * 100).toFixed(0)}¢ (${(yesPrice * 100).toFixed(0)}% probability), NO: ${(noPrice * 100).toFixed(0)}¢ (${(noPrice * 100).toFixed(0)}% probability).`;
      } else if (yesPrice !== null) {
        currentPricesText = `YES: ${(yesPrice * 100).toFixed(0)}¢ (${(yesPrice * 100).toFixed(0)}% probability).`;
      } else if (noPrice !== null) {
        currentPricesText = `NO: ${(noPrice * 100).toFixed(0)}¢ (${(noPrice * 100).toFixed(0)}% probability).`;
      }

      let orderResponse;
      
      try {
        if (selectedModel === 'hy-preview') {
          orderResponse = await parseWithHunyuan(request.prompt, combinedTitle, hyKey, currentPricesText);
        } else if (selectedModel === 'gemini') {
          if (apiKey) {
            orderResponse = await parseWithGemini(request.prompt, combinedTitle, apiKey, currentPricesText);
          } else {
            throw new Error('Gemini API key is not configured.');
          }
        } else {
          // Default to goose local agent
          orderResponse = await parseWithGoose(request.prompt, combinedTitle, serverUrl, currentPricesText);
        }
      } catch (err) {
        console.warn(`${selectedModel} parsing failed, falling back to Gemini or Regex:`, err);
        // Robust fallback cascade
        try {
          if (apiKey) {
            orderResponse = await parseWithGemini(request.prompt, combinedTitle, apiKey, currentPricesText);
          } else {
            throw new Error('Gemini API key not configured for fallback.');
          }
        } catch (fallbackErr) {
          orderResponse = parseWithRegex(request.prompt, combinedTitle);
        }
      }
      
      if (orderResponse && orderResponse.id) {
        let slug = '';
        if (request.marketContext && request.marketContext.url) {
          try {
            const urlObj = new URL(request.marketContext.url);
            const pathParts = urlObj.pathname.split('/');
            slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
          } catch (e) {
            console.error("Failed to parse URL in PARSE_ORDER:", e);
          }
        }
        
        if (slug) {
          orderResponse.slug = slug;
          const targetOutcome = request.marketContext.activeOutcome || '';
          
          let domPrice = null;
          if (request.marketContext.domPrices) {
            const outcomeKey = orderResponse.outcome.toLowerCase();
            if (outcomeKey === 'yes' && request.marketContext.domPrices.yes !== undefined) {
              domPrice = request.marketContext.domPrices.yes;
            } else if (outcomeKey === 'no' && request.marketContext.domPrices.no !== undefined) {
              domPrice = request.marketContext.domPrices.no;
            }
          }
          
          const realPrice = await getCurrentPriceFromGamma(slug, orderResponse.outcome, targetOutcome);
          const estPrice = orderResponse.limitPrice || domPrice || realPrice || 0.45;
          orderResponse.estShares = (orderResponse.amountUSDC / estPrice).toFixed(1);
          if (orderResponse.limitPrice) {
            orderResponse.limitPrice = Math.round(orderResponse.limitPrice * 100) / 100;
          }
        }
      }

      sendResponse({ 
        orderParsed: !!(orderResponse && orderResponse.id), 
        order: orderResponse, 
        replyText: orderResponse ? orderResponse.replyText : 'No response from AI agent.' 
      });
    });
    return true; // Keep message channel open
  }

  if (request.type === 'EXECUTE_ORDER') {
    chrome.storage.local.get([
      'liveMode',
      'liveAddress',
      'clobKey',
      'clobSecret',
      'clobPassphrase'
    ], async (config) => {
      const result = await executeOrder(request.order, config);
      if (result.success && result.status !== 'pending') {
        await updateStorageAfterOrder(result.receipt);
      }
      sendResponse(result);
    });
    return true;
  }

  if (request.type === 'LOG_CHAT_MESSAGE') {
    chrome.storage.local.get(['chatHistory'], (items) => {
      let chatHistory = items.chatHistory || [];
      let session = chatHistory.find(s => s.id === request.sessionId);
      if (!session) {
        session = {
          id: request.sessionId,
          marketTitle: request.marketTitle,
          slug: request.slug,
          timestamp: Date.now(),
          messages: []
        };
        chatHistory.push(session);
      }
      session.messages.push({
        sender: request.sender,
        payload: request.payload,
        timestamp: Date.now()
      });
      if (chatHistory.length > 50) {
        chatHistory = chatHistory.slice(chatHistory.length - 50);
      }
      chrome.storage.local.set({ chatHistory }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.type === 'FETCH_SIGNALS') {
    chrome.storage.local.get(['xapiServer'], async (items) => {
      const serverUrl = items.xapiServer || 'http://localhost:3000';
      try {
        const signals = await fetchSignals(request.marketTitle, serverUrl);
        sendResponse(signals);
      } catch (err) {
        sendResponse({ error: true, message: err.message });
      }
    });
    return true; // Keep message channel open
  }

  if (request.type === 'CANCEL_ANALYZE_COMMENTS') {
    const controller = activeAnalysisControllers.get(request.slug);
    if (controller) {
      controller.abort();
      activeAnalysisControllers.delete(request.slug);
      console.log(`[Polymarket AI Agent] Cancelled analysis for ${request.slug}`);
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.type === 'ANALYZE_COMMENTS') {
    if (activeAnalysisControllers.has(request.slug)) {
      try {
        activeAnalysisControllers.get(request.slug).abort();
      } catch (e) {
        console.warn(e);
      }
      activeAnalysisControllers.delete(request.slug);
    }
    
    const controller = new AbortController();
    activeAnalysisControllers.set(request.slug, controller);

    chrome.storage.local.get(['geminiKey', 'xapiServer', 'hunyuanKey', 'selectedModel'], async (items) => {
      const apiKey = items.geminiKey;
      const serverUrl = items.xapiServer || 'http://localhost:3000';
      const hyKey = items.hunyuanKey || 'sk-sIhWqkQ1LzqsqgXupL2YpmY9dkJcziJxGBGXkL9CkfOW2yLs';
      const selectedModel = items.selectedModel || 'goose';
      try {
        const result = await fetchCommentsAndTwitter(request.slug, request.marketTitle, serverUrl, apiKey, hyKey, selectedModel, controller.signal);
        if (controller.signal.aborted) {
          sendResponse({ error: true, aborted: true, message: 'Aborted' });
        } else {
          sendResponse({ success: true, ...result });
        }
      } catch (err) {
        if (err.name === 'AbortError' || controller.signal.aborted) {
          sendResponse({ error: true, aborted: true, message: 'Aborted' });
        } else {
          sendResponse({ error: true, message: err.message });
        }
      } finally {
        if (activeAnalysisControllers.get(request.slug) === controller) {
          activeAnalysisControllers.delete(request.slug);
        }
      }
    });
    return true; // Keep message channel open
  }

  if (request.type === 'GET_CURRENT_PRICE') {
    getCurrentPriceFromGamma(request.slug, request.outcome, request.targetOutcome)
      .then(price => {
        sendResponse({ success: true, price });
      })
      .catch(err => {
        console.error("Error in GET_CURRENT_PRICE handler:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open
  }
});

// Fetch comments and Twitter signals, analyze comments via Gemini and format response
async function fetchCommentsAndTwitter(slug, marketTitle, serverUrl, apiKey, hyKey, selectedModel, signal) {
  let eventTitle = marketTitle || slug;
  let commentsText = '';
  let commentsArray = [];
  
  // 1. Fetch Comments from Polymarket Gamma API
  try {
    const eventUrl = `https://gamma-api.polymarket.com/events/slug/${slug}`;
    const eventRes = await fetch(eventUrl, { signal });
    if (eventRes.ok) {
      const eventData = await eventRes.json();
      if (eventData && eventData.id) {
        eventTitle = eventData.title || eventTitle;
        const commentsUrl = `https://gamma-api.polymarket.com/comments?parent_entity_type=Event&parent_entity_id=${eventData.id}&get_positions=true&limit=60`;
        const commentsRes = await fetch(commentsUrl, { signal });
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          commentsArray = commentsData.results || commentsData || [];
          if (Array.isArray(commentsArray) && commentsArray.length > 0) {
            commentsText = commentsArray.map(c => {
              const user = c.userAddress ? `${c.userAddress.substring(0, 6)}...${c.userAddress.substring(38)}` : 'User';
              return `${user}: ${c.comment || ''}`;
            }).join('\n');
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to fetch comments from Polymarket API:', err);
    if (err.name === 'AbortError') throw err;
  }

  // 2. Fetch Twitter/X Signals from Local xapi Daemon
  let twitterSignals = [];
  let twitterError = null;
  try {
    const encodedTitle = encodeURIComponent(eventTitle);
    const twitterRes = await fetch(`${serverUrl}/twitter_signals?query=${encodedTitle}`, { signal });
    if (twitterRes.ok) {
      const twitterData = await twitterRes.json();
      if (twitterData.success === false) {
        twitterError = twitterData.error?.message || 'xapi search failed';
      } else {
        twitterSignals = twitterData.tweets || [];
      }
    } else {
      twitterError = `Daemon returned status ${twitterRes.status}`;
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('Failed to fetch Twitter signals from daemon:', err);
    twitterError = err.message || 'Failed to connect to local daemon';
  }

  // 3. Analyze Comments via Selected Model
  let analysis = '';
  let analysisInput = commentsText;
  if (!analysisInput && twitterSignals.length > 0) {
    analysisInput = "Below are related Twitter discussions for this market, please analyze them as comments:\n\n" + 
      twitterSignals.map(t => `${t.author}: ${t.content}`).join('\n');
  }

  if (!analysisInput) {
    analysis = `### 暂无数据\n\n该预测市场当前没有用户评论，且未检测到相关 Twitter 舆情。`;
  } else {
    try {
      if (selectedModel === 'gemini') {
        analysis = await analyzeWithGemini(analysisInput, eventTitle, apiKey);
      } else if (selectedModel === 'hy-preview') {
        analysis = await analyzeWithHunyuan(analysisInput, eventTitle, hyKey);
      } else {
        // default/goose: local daemon
        analysis = await analyzeWithLocalDaemon(analysisInput, eventTitle, serverUrl, signal);
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('Comments analysis failed:', err);
      
      let configTip = '';
      if (selectedModel === 'gemini') {
        configTip = '未配置 Gemini API 密钥。请点击插件右上角图标进入配置页面，设置 Gemini API 密钥以启用智能舆情情绪分析。';
      } else if (selectedModel === 'hy-preview') {
        configTip = '未配置腾讯混元 API 密钥。请点击插件右上角图标进入配置页面，设置腾讯混元 API 密钥。';
      } else {
        configTip = `无法连接本地 AI 守护进程：${err.message}。请确保 xapi_daemon.js 正在后台运行。`;
      }
      analysis = `### 提示\n\n${configTip}`;
    }
  }

  return {
    analysis,
    twitterSignals,
    twitterError
  };
}

const COMMENTS_SYSTEM_PROMPT = `You are a Polymarket sentiment analyst. Your task is to analyze user comments from a prediction market event. Summarize:
1. Overall market sentiment (Bullish/Bearish on YES outcome) in percentage estimation (e.g., 70% bullish, 30% bearish).
2. Key arguments, debates, and points of agreement/disagreement among traders.
3. Notable positions or actions stated by commenters.
Output the analysis in clean Chinese using markdown headers and bullet points. Do not include markdown code block wrappers (e.g. \`\`\`markdown).`;

// Helper: Analyze via Gemini API
async function analyzeWithGemini(commentsText, eventTitle, apiKey) {
  if (!apiKey) {
    throw new Error('未配置 Gemini API 密钥。请进入配置页面设置以启用。');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${COMMENTS_SYSTEM_PROMPT}\n\nPolymarket Event: "${eventTitle}"\n\nComments:\n${commentsText}` }] }]
    })
  });
  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }
  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
    throw new Error('Gemini API returned empty response');
  }
  return data.candidates[0].content.parts[0].text.trim();
}

// Helper: Analyze via Hunyuan API
async function analyzeWithHunyuan(commentsText, eventTitle, hyKey) {
  if (!hyKey) {
    throw new Error('未配置 Hunyuan API 密钥。请进入配置页面设置以启用。');
  }
  const url = 'https://tokenhub.tencentmaas.com/v1/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${hyKey}`
    },
    body: JSON.stringify({
      model: 'hy3-preview',
      messages: [
        { role: 'system', content: COMMENTS_SYSTEM_PROMPT },
        { role: 'user', content: `Analyze the following user comments for Polymarket event "${eventTitle}":\n\n${commentsText}` }
      ],
      stream: false
    })
  });
  if (!response.ok) {
    throw new Error(`Hunyuan API returned status ${response.status}`);
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
    throw new Error('Hunyuan API returned empty choices');
  }
  return data.choices[0].message.content.trim();
}

// Helper: Analyze via Local Daemon
async function analyzeWithLocalDaemon(commentsText, eventTitle, serverUrl, signal) {
  const response = await fetch(`${serverUrl}/analyze_comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventTitle,
      commentsText
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`Daemon returned status ${response.status}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Daemon analysis failed');
  }
  return data.analysis;
}

// Local Comments sentiment report fallback
function getLocalCommentsFallback(slug) {
  if (slug.includes('iran') || slug.includes('peace') || slug.includes('middle-east')) {
    return `### 评论区舆情分析报告 (本地 AI 离线分析)

*   **市场情绪指数**：**65% 看好 YES（达成和平协议）**，**35% 看好 NO**。
*   **多方核心论点 (YES)**：
    *   **停火进展**：交易者指出巴基斯坦作为协调方在中东事务中的斡旋非常积极，60天停火协议框架草案已经通过，目前静候特朗普签字。
    *   **经济崩溃压力**：多条评论指出伊朗国内通胀严重，迫切需要通过达成协议来换取经济和制裁 of 临时解冻。
*   **空方主要疑虑 (NO)**：
    *   **条款谈判拉锯**：空方评论者主要担忧美国在核查机制和弹道导弹限制上的苛刻条件会导致最终决策延期。
    *   **外部局势升温**：担忧以色列对黎巴嫩的军事行动以及红海局势会迫使伊朗采取更强硬的报复性言论，从而打断和平谈判。
*   **持仓筹码分布**：
    *   评论区持有仓位（Positions）的标签显示，大户目前倾向于建仓 YES 合约持有至 12 月底，而散户则倾向于在 6 月 30 日等短期合约中进行波动投机。`;
  }

  return `### 评论区舆情分析报告 (本地 AI 离线分析)

*   **市场情绪指数**：**58% 看好 YES**，**42% 看好 NO**。
*   **主要讨论焦点**：
    *   **基本面博弈**：讨论集中在近期的新闻爆料与大户的持仓变化。看多派认为价格存在明显折价，具备套利空间；看空派认为市场情绪过热。
    *   **推特流言与信息差**：用户在讨论区频繁分享推特知名博主的言论截图，并对消息真实性进行激烈的多方对质。
*   **持仓观点分布**：
    *   评论区讨论者倾向于从自身持仓角度进行倾向性解读，情绪表现较为剧烈，目前多空博弈激烈。`;
}

// Local Twitter search fallback
function getLocalTwitterFallback(title) {
  const query = (title || '').toLowerCase();
  if (query.includes('iran') || query.includes('peace') || query.includes('停火') || query.includes('和平')) {
    return [
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
    ];
  }
  return [
    {
      author: "Market Whales (@WhaleAlerts)",
      impact: "Bullish",
      content: `Huge volume spike on Polymarket for "${title}". Big money accounts are loading up on YES contracts.`,
      time: "2m ago"
    },
    {
      author: "Sentiment Sentinel (@SentimentSentinel)",
      impact: "Bearish",
      content: `Social sentiment on X for "${title}" is turning cautious. Users are noting delay risks in official filings.`,
      time: "15m ago"
    },
    {
      author: "Polymarket Stats (@PM_Stats)",
      impact: "Neutral",
      content: `Trading volume for "${title}" reaches $2.5M. consensus still forming.`,
      time: "48m ago"
    }
  ];
}

async function updateStorageAfterOrder(receipt) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['simBalance', 'positions'], (items) => {
      let simBalance = items.simBalance !== undefined ? parseFloat(items.simBalance) : 1000.00;
      let positions = items.positions || [];

      const shares = parseFloat(receipt.shares) || 0;
      const avgPrice = parseFloat(receipt.avgPrice) || 0;
      const totalSpent = parseFloat(receipt.totalSpent) || (shares * avgPrice);
      const isSimulation = !!receipt.isSimulation;
      const type = receipt.type || 'BUY';

      if (isSimulation) {
        if (type === 'BUY') {
          simBalance -= totalSpent;
        } else if (type === 'SELL') {
          simBalance += totalSpent;
        }
      }

      const posIndex = positions.findIndex(p => p.slug === receipt.slug && p.outcome === receipt.outcome && p.isSimulation === isSimulation);

      if (type === 'BUY') {
        if (posIndex > -1) {
          const pos = positions[posIndex];
          const oldShares = parseFloat(pos.shares) || 0;
          const oldTotalSpent = parseFloat(pos.totalSpent) || 0;

          const newShares = oldShares + shares;
          const newTotalSpent = oldTotalSpent + totalSpent;
          
          pos.shares = newShares;
          pos.totalSpent = newTotalSpent;
          pos.avgPrice = newShares > 0 ? (newTotalSpent / newShares) : 0;
          pos.timestamp = Date.now();
        } else {
          positions.push({
            id: 'pos_' + Math.random().toString(36).substring(2, 11),
            marketTitle: receipt.marketTitle,
            slug: receipt.slug,
            outcome: receipt.outcome || 'YES',
            shares: shares,
            avgPrice: avgPrice,
            totalSpent: totalSpent,
            isSimulation: isSimulation,
            timestamp: Date.now()
          });
        }
      } else if (type === 'SELL') {
        if (posIndex > -1) {
          const pos = positions[posIndex];
          const oldShares = parseFloat(pos.shares) || 0;
          const oldTotalSpent = parseFloat(pos.totalSpent) || 0;

          if (shares >= oldShares) {
            positions.splice(posIndex, 1);
          } else {
            const newShares = oldShares - shares;
            pos.shares = newShares;
            pos.totalSpent = newShares * pos.avgPrice;
            pos.timestamp = Date.now();
          }
        }
      }

      chrome.storage.local.set({
        simBalance: parseFloat(simBalance.toFixed(2)),
        positions: positions
      }, () => {
        resolve();
      });
    });
  });
}

async function addPendingOrderToStorage(order) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['pendingOrders', 'simBalance'], (items) => {
      let pendingOrders = items.pendingOrders || [];
      let simBalance = items.simBalance !== undefined ? parseFloat(items.simBalance) : 1000.00;

      simBalance -= parseFloat(order.totalSpent) || 0;
      pendingOrders.push(order);

      chrome.storage.local.set({
        pendingOrders: pendingOrders,
        simBalance: parseFloat(simBalance.toFixed(2))
      }, () => {
        resolve();
      });
    });
  });
}

// Start background monitoring loop
setInterval(checkPendingOrders, 8000);

chrome.alarms.create('checkPendingOrdersAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkPendingOrdersAlarm') {
    checkPendingOrders();
  }
});

function translateChineseToEnglish(text) {
  if (!text) return '';
  const dict = {
    '西班牙': 'spain',
    '厄瓜多尔': 'ecuador',
    '巴西': 'brazil',
    '阿根廷': 'argentina',
    '法国': 'france',
    '德国': 'germany',
    '英格兰': 'england',
    '意大利': 'italy',
    '荷兰': 'netherlands',
    '葡萄牙': 'portugal',
    '美国': 'usa',
    '中国': 'china',
    '日本': 'japan',
    '川普': 'trump',
    '特朗普': 'trump',
    '哈里斯': 'harris',
    '拜登': 'biden',
    '奥巴马': 'obama',
    '马斯克': 'musk',
    '普京': 'putin',
    '泽连斯基': 'zelensky',
    '内塔尼亚胡': 'netanyahu'
  };
  
  let lower = text.toLowerCase().trim();
  for (const [zh, en] of Object.entries(dict)) {
    if (lower.includes(zh)) {
      return en;
    }
  }
  return lower;
}

function extractSubOutcomeFromTitle(title) {
  if (!title) return '';
  const match = title.match(/\(([^)]+)\)/);
  return match ? match[1].trim() : '';
}

function matchTargetOutcome(qText, gitText, targetOutcome) {
  if (!targetOutcome) return false;
  qText = qText.toLowerCase();
  gitText = gitText.toLowerCase();
  
  // Clean targetOutcome
  let target = targetOutcome.toLowerCase().trim();
  
  // Try translating Chinese date to English components
  const dateMatch = target.match(/(\d+)月(\d+)日/);
  if (dateMatch) {
    const mNum = parseInt(dateMatch[1]);
    const dNum = parseInt(dateMatch[2]);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthsFull = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    if (mNum >= 1 && mNum <= 12) {
      const mAbbr = months[mNum - 1];
      const mFull = monthsFull[mNum - 1];
      // Check if both month and day exist in either qText or gitText
      const matchQ = (qText.includes(mAbbr) || qText.includes(mFull)) && qText.includes(dNum.toString());
      const matchGit = (gitText.includes(mAbbr) || gitText.includes(mFull)) && gitText.includes(dNum.toString());
      if (matchQ || matchGit) {
        return true;
      }
    }
  }

  // Also translate Chinese names/countries using dictionary
  const translated = translateChineseToEnglish(target);
  if (qText.includes(translated) || gitText.includes(translated) || translated.includes(gitText)) {
    return true;
  }
  
  return false;
}

async function getCurrentPriceFromGamma(slug, outcome, targetOutcome = '') {
  try {
    // 1. Try querying /markets?slug=${slug} first (most robust for specific market pages)
    const marketRes = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
    if (marketRes.ok) {
      const marketsData = await marketRes.json();
      if (marketsData && marketsData.length > 0) {
        const m = marketsData[0];
        let outcomes = m.outcomes;
        if (typeof outcomes === 'string') {
          try { outcomes = JSON.parse(outcomes); } catch(e) {}
        }
        let prices = m.outcomePrices;
        if (typeof prices === 'string') {
          try { prices = JSON.parse(prices); } catch(e) {}
        }

        const outcomesClean = outcomes ? outcomes.map(o => o.trim().toLowerCase()) : [];
        const pricesClean = prices ? prices.map(p => parseFloat(p)) : [];

        let outcomeIndex = outcomesClean.indexOf(outcome.trim().toLowerCase());
        if (outcomeIndex === -1) {
          outcomeIndex = outcomesClean.findIndex(o => o.includes(outcome.trim().toLowerCase()) || outcome.trim().toLowerCase().includes(o));
        }
        if (outcomeIndex > -1 && pricesClean[outcomeIndex] !== undefined) {
          return pricesClean[outcomeIndex];
        }
      }
    }

    // 2. Fallback: Query /events/slug/${slug} (handles multi-outcome events)
    const res = await fetch(`https://gamma-api.polymarket.com/events/slug/${slug}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.markets) return null;
    
    let matchedMarket = null;
    
    if (targetOutcome && data.markets.length > 1) {
      for (const m of data.markets) {
        if (matchTargetOutcome(m.question || '', m.groupItemTitle || '', targetOutcome)) {
          matchedMarket = m;
          break;
        }
      }
    }
    
    if (!matchedMarket && data.markets.length > 0) {
      matchedMarket = data.markets[0];
    }
    
    if (matchedMarket) {
      let outcomes = matchedMarket.outcomes;
      if (typeof outcomes === 'string') {
        try { outcomes = JSON.parse(outcomes); } catch(e) {}
      }
      let prices = matchedMarket.outcomePrices;
      if (typeof prices === 'string') {
        try { prices = JSON.parse(prices); } catch(e) {}
      }

      const outcomesClean = outcomes ? outcomes.map(o => o.trim().toLowerCase()) : [];
      const pricesClean = prices ? prices.map(p => parseFloat(p)) : [];

      let outcomeIndex = outcomesClean.indexOf(outcome.trim().toLowerCase());
      if (outcomeIndex === -1) {
        outcomeIndex = outcomesClean.findIndex(o => o.includes(outcome.trim().toLowerCase()) || outcome.trim().toLowerCase().includes(o));
      }
      
      if (outcomeIndex > -1 && pricesClean[outcomeIndex] !== undefined) {
        return pricesClean[outcomeIndex];
      }
    }
    return null;
  } catch (e) {
    console.error("Failed to fetch price from Gamma API in background:", e);
    return null;
  }
}

function formatPrice(price) {
  if (price === undefined || price === null) return '--';
  return '$' + parseFloat(price).toFixed(2);
}

async function checkPendingOrders() {
  chrome.storage.local.get(['pendingOrders', 'positions', 'chatHistory'], async (items) => {
    let pendingOrders = items.pendingOrders || [];
    if (pendingOrders.length === 0) return;

    let positions = items.positions || [];
    let chatHistory = items.chatHistory || [];
    let updated = false;
    let newPendingOrders = [];

    for (const order of pendingOrders) {
      let currentPrice = null;
      if (order.slug) {
        const subOutcome = extractSubOutcomeFromTitle(order.marketTitle);
        currentPrice = await getCurrentPriceFromGamma(order.slug, order.outcome, subOutcome);
      }
      
      if (currentPrice === null) {
        newPendingOrders.push(order);
        continue;
      }
      
      currentPrice = Math.round(currentPrice * 100) / 100;

      let shouldFill = false;
      if (order.type === 'BUY') {
        if (currentPrice <= order.limitPrice) {
          shouldFill = true;
        }
      } else if (order.type === 'SELL') {
        if (currentPrice >= order.limitPrice) {
          shouldFill = true;
        }
      }

      if (shouldFill) {
        console.log(`[Polymarket AI Agent] Pending limit order filled! ID: ${order.id}, price: ${currentPrice}`);
        updated = true;

        const receipt = {
          id: 'tx_' + Math.random().toString(36).substring(2, 11),
          marketTitle: order.marketTitle,
          slug: order.slug,
          outcome: order.outcome,
          type: order.type,
          shares: order.shares,
          avgPrice: currentPrice,
          totalSpent: order.totalSpent,
          isSimulation: true,
          timestamp: Date.now()
        };

        const posIndex = positions.findIndex(p => p.slug === order.slug && p.outcome === order.outcome && p.isSimulation === true);
        if (order.type === 'BUY') {
          if (posIndex > -1) {
            const pos = positions[posIndex];
            const oldShares = parseFloat(pos.shares) || 0;
            const oldTotalSpent = parseFloat(pos.totalSpent) || 0;

            const newShares = oldShares + parseFloat(order.shares);
            const newTotalSpent = oldTotalSpent + parseFloat(order.totalSpent);
            
            pos.shares = newShares;
            pos.totalSpent = newTotalSpent;
            pos.avgPrice = newShares > 0 ? (newTotalSpent / newShares) : 0;
            pos.timestamp = Date.now();
          } else {
            positions.push({
              id: 'pos_' + Math.random().toString(36).substring(2, 11),
              marketTitle: order.marketTitle,
              slug: order.slug,
              outcome: order.outcome,
              shares: parseFloat(order.shares),
              avgPrice: currentPrice,
              totalSpent: parseFloat(order.totalSpent),
              isSimulation: true,
              timestamp: Date.now()
            });
          }
        }

        if (order.sessionId) {
          const session = chatHistory.find(s => s.id === order.sessionId);
          if (session) {
            session.messages.push({
              sender: 'order_receipt',
              payload: { receipt: receipt },
              timestamp: Date.now()
            });
          }
        }

        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'popup.html',
          title: 'AI 交易助手限价单成交',
          message: `您挂出的 ${order.outcome} 限价单已以 ${formatPrice(currentPrice)} 成交！`,
          priority: 2
        }, () => {});

      } else {
        newPendingOrders.push(order);
      }
    }

    if (updated) {
      chrome.storage.local.set({
        pendingOrders: newPendingOrders,
        positions: positions,
        chatHistory: chatHistory
      }, () => {
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.url && tab.url.includes('polymarket.com')) {
              chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
            }
          }
        });
      });
    }
  });
}

