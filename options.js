/* Options Dashboard Controller Script */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const navBtns = document.querySelectorAll('.pm-nav-btn');
  const tabViews = document.querySelectorAll('.tab-view');
  
  // Settings Elements
  const liveModeInput = document.getElementById('live-mode');
  const selectedModelInput = document.getElementById('selected-model');
  const liveAddressInput = document.getElementById('live-address');
  const clobKeyInput = document.getElementById('clob-key');
  const clobSecretInput = document.getElementById('clob-secret');
  const clobPassphraseInput = document.getElementById('clob-passphrase');
  const geminiKeyInput = document.getElementById('gemini-key');
  const hunyuanKeyInput = document.getElementById('hunyuan-key');
  const xapiServerInput = document.getElementById('xapi-server');
  
  const saveBtn = document.getElementById('save-btn');
  const toastMsg = document.getElementById('toast-msg');
  
  const daemonDot = document.getElementById('daemon-dot');
  const daemonText = document.getElementById('daemon-status-text');
  const clobDot = document.getElementById('clob-dot');
  const clobText = document.getElementById('clob-status-text');

  // Header Elements
  const headerWalletBalance = document.getElementById('header-wallet-balance');
  const headerWalletAddress = document.getElementById('header-wallet-address');

  // Redeem Modal Elements & Bindings
  let activeRedeemPosition = null;
  const modal = document.getElementById('custom-confirm-modal');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  const closeRedeemModal = () => {
    modal.classList.remove('active');
    activeRedeemPosition = null;
  };

  modalCancelBtn.addEventListener('click', closeRedeemModal);
  modalCloseBtn.addEventListener('click', closeRedeemModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRedeemModal();
  });

  modalConfirmBtn.addEventListener('click', () => {
    if (activeRedeemPosition) {
      const { pos, value } = activeRedeemPosition;
      closeRedeemModal();

      chrome.storage.local.get(['simBalance', 'positions'], (res) => {
        let balance = res.simBalance !== undefined ? parseFloat(res.simBalance) : 1000.00;
        let currPositions = res.positions || [];

        // Remove position
        currPositions = currPositions.filter(p => p.id !== pos.id);
        balance += value;

        chrome.storage.local.set({
          simBalance: parseFloat(balance.toFixed(2)),
          positions: currPositions
        }, () => {
          refreshWalletHeader();
          loadPortfolioView();
          showToast('兑换成功！已将资金赎回至您的模拟钱包。', 'success');
        });
      });
    }
  });

  // Tab switching logic
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      
      // Update active nav button
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update active view
      tabViews.forEach(view => {
        view.classList.remove('active');
        view.style.display = 'none';
      });
      
      const activeView = document.getElementById(`tab-view-${tabId}`);
      if (activeView) {
        activeView.classList.add('active');
        activeView.style.display = 'block';
      }

      // Action on tab load
      if (tabId === 'portfolio') {
        loadPortfolioView();
      } else if (tabId === 'history') {
        loadHistoryView();
      }
    });
  });

  // Load existing values & Wallet header
  function refreshWalletHeader() {
    chrome.storage.local.get(['simBalance', 'liveAddress'], (items) => {
      const balance = items.simBalance !== undefined ? parseFloat(items.simBalance) : 1000.00;
      headerWalletBalance.innerText = `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;

      if (items.liveAddress) {
        const addr = items.liveAddress;
        headerWalletAddress.innerText = addr.substring(0, 6) + '...' + addr.substring(38);
        headerWalletAddress.title = addr;
      } else {
        headerWalletAddress.innerText = '0x71C...8921';
        headerWalletAddress.title = 'Simulated Wallet Address (0x71C839598a3b8e737c35293d09a25db95c738921)';
      }
    });
  }

  // Load settings fields
  chrome.storage.local.get([
    'liveMode',
    'selectedModel',
    'liveAddress',
    'clobKey',
    'clobSecret',
    'clobPassphrase',
    'geminiKey',
    'hunyuanKey',
    'xapiServer'
  ], (items) => {
    if (items.liveMode) liveModeInput.checked = items.liveMode;
    if (items.selectedModel) selectedModelInput.value = items.selectedModel;
    if (items.liveAddress) liveAddressInput.value = items.liveAddress;
    if (items.clobKey) clobKeyInput.value = items.clobKey;
    if (items.clobSecret) clobSecretInput.value = items.clobSecret;
    if (items.clobPassphrase) clobPassphraseInput.value = items.clobPassphrase;
    if (items.geminiKey) geminiKeyInput.value = items.geminiKey;
    if (items.hunyuanKey) hunyuanKeyInput.value = items.hunyuanKey;
    if (items.xapiServer) {
      xapiServerInput.value = items.xapiServer;
    } else {
      xapiServerInput.value = 'http://localhost:3000';
    }

    refreshWalletHeader();
    updateClobStatusBadge();
    checkDaemonStatus();
  });

  // Toggle eye visibility
  const eyeBtns = document.querySelectorAll('.eye-btn');
  eyeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        const isPwd = input.getAttribute('type') === 'password';
        input.setAttribute('type', isPwd ? 'text' : 'password');
        btn.style.color = isPwd ? 'var(--pm-blue)' : 'var(--pm-text-secondary)';
      }
    });
  });

  // Warning when enabling Live Mode
  liveModeInput.addEventListener('change', () => {
    if (liveModeInput.checked) {
      const confirmWarning = confirm(
        "【安全警告】警告：开启实盘交易模式后，AI 交易助手将直接向 Polymarket 的智能合约提交真实资金交易请求！\n\n请务必确认您的钱包地址和 CLOB API Key 配置无误。您确定要开启实盘模式吗？"
      );
      if (!confirmWarning) {
        liveModeInput.checked = false;
      }
    }
  });

  // Evaluate CLOB Configured status locally
  function updateClobStatusBadge() {
    const address = liveAddressInput.value.trim();
    const key = clobKeyInput.value.trim();
    
    if (address && key) {
      clobDot.className = 'status-dot online';
      clobText.innerText = 'Configured';
    } else {
      clobDot.className = 'status-dot offline';
      clobText.innerText = 'Unconfigured';
    }
  }

  // Ping local xapi bridge daemon to verify connectivity
  async function checkDaemonStatus() {
    const serverUrl = xapiServerInput.value.trim() || 'http://localhost:3000';
    
    try {
      daemonText.innerText = 'Connecting...';
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${serverUrl}/ping`, { 
        method: 'GET',
        signal: controller.signal 
      });
      clearTimeout(id);

      if (response.ok) {
        daemonDot.className = 'status-dot online';
        daemonText.innerText = 'Online';
      } else {
        throw new Error('Not OK');
      }
    } catch (err) {
      daemonDot.className = 'status-dot offline';
      daemonText.innerText = 'Offline';
    }
  }

  xapiServerInput.addEventListener('change', checkDaemonStatus);

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const liveMode = liveModeInput.checked;
    const selectedModel = selectedModelInput.value;
    const liveAddress = liveAddressInput.value.trim();
    const clobKey = clobKeyInput.value.trim();
    const clobSecret = clobSecretInput.value.trim();
    const clobPassphrase = clobPassphraseInput.value.trim();
    const geminiKey = geminiKeyInput.value.trim();
    const hunyuanKey = hunyuanKeyInput.value.trim();
    const xapiServer = xapiServerInput.value.trim() || 'http://localhost:3000';

    if (liveAddress && (!liveAddress.startsWith('0x') || liveAddress.length !== 42)) {
      showToast('错误：Polygon 钱包地址格式不正确，必须为 0x 开头的 42 位哈希。', 'error');
      return;
    }

    if (liveMode && (!liveAddress || !clobKey || !clobSecret || !clobPassphrase)) {
      showToast('错误：开启实盘模式需要提供完整的 Polygon 钱包地址和 CLOB API 证书。', 'error');
      return;
    }

    chrome.storage.local.set({
      liveMode,
      selectedModel,
      liveAddress,
      clobKey,
      clobSecret,
      clobPassphrase,
      geminiKey,
      hunyuanKey,
      xapiServer
    }, () => {
      showToast('系统配置保存成功！', 'success');
      
      updateClobStatusBadge();
      checkDaemonStatus();
      refreshWalletHeader();

      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.url && tab.url.includes('polymarket.com')) {
            chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
          }
        }
      });
    });
  });

  function showToast(msg, type) {
    toastMsg.className = `toast-msg ${type}`;
    toastMsg.innerText = msg;
    setTimeout(() => {
      toastMsg.innerText = '';
    }, 4000);
  }

  // ----------------------------------------------------
  // 1. PORTFOLIO LOGIC
  // ----------------------------------------------------
  async function loadPortfolioView() {
    const listContainer = document.getElementById('portfolio-list');
    listContainer.innerHTML = '<div style="text-align:center; padding:40px; color:var(--pm-text-secondary);">正在加载持仓列表及实时价格...</div>';

    chrome.storage.local.get(['positions'], async (items) => {
      const positions = items.positions || [];
      if (positions.length === 0) {
        listContainer.innerHTML = `
          <div class="portfolio-empty">
            <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
            <h3>目前无任何持仓</h3>
            <p>通过 Polymarket AI 交易助手下单后，您的模拟仓位将在此显示。</p>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = ''; // Clear

      for (const pos of positions) {
        let avgPrice = parseFloat(pos.avgPrice) || 0;
        avgPrice = Math.round(avgPrice * 100) / 100;

        // Fetch current price from Gamma API
        let currentPrice = null;
        if (pos.slug) {
          const subOutcome = extractSubOutcomeFromTitle(pos.marketTitle);
          currentPrice = await fetchCurrentPrice(pos.slug, pos.outcome, subOutcome);
        }

        // Fallback to average price if fetching fails (no simulated fake fluctuations)
        if (currentPrice === null) {
          currentPrice = avgPrice;
        }

        currentPrice = Math.round(currentPrice * 100) / 100;

        const shares = parseFloat(pos.shares) || 0;
        const totalSpent = parseFloat(pos.totalSpent) || (shares * avgPrice);
        const value = shares * currentPrice;
        const potentialProfit = shares * 1.00; // In Polymarket YES/NO resolves to $1.00

        const profit = value - totalSpent;
        const profitPct = totalSpent > 0 ? (profit / totalSpent) * 100 : 0;

        // Determine icon based on market title
        const isBtc = pos.marketTitle.toLowerCase().includes('bitcoin') || pos.marketTitle.toLowerCase().includes('btc');
        const isEth = pos.marketTitle.toLowerCase().includes('ethereum') || pos.marketTitle.toLowerCase().includes('eth');
        
        let iconHtml = '';
        if (isBtc) {
          iconHtml = `
            <div class="market-icon">
              <svg viewBox="0 0 24 24" style="fill: #f59e0b;"><path d="M23.6 12.5c-.3-2.3-1.6-4.1-3.6-5.1.2-1.3-.1-2.9-.9-4.2-1.3-.9-3-.7-4.3-.2C13.6 2.3 12 2 10.3 2.1c-.8-1.3-2.1-2-3.6-2.1-1.3.1-2.4 1-2.9 2.2C3.1 2.4 2 3.1 1.4 4.2c.2 1.3-.1 2.9-.9 4.2 1.3.9 3 .7 4.3.2 1.2.7 2.8 1 4.5.9.8 1.3 2.1 2 3.6 2.1 1.3-.1 2.4-1 2.9-2.2 1 .2 2.1-.5 2.7-1.6-.2-1.3.1-2.9.9-4.2-1.3-.9-3-.7-4.3-.2z"/></svg>
            </div>
          `;
        } else if (isEth) {
          iconHtml = `
            <div class="market-icon" style="background-color: #627eea;">
              <svg viewBox="0 0 24 24"><path d="M12 2L3.5 16 12 21l8.5-5L12 2zm0 16.5L6.2 15 12 8.7l5.8 6.3-5.8 3.5z"/></svg>
            </div>
          `;
        } else {
          iconHtml = `
            <div class="market-icon generic">
              <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
            </div>
          `;
        }

        // Format outcome classes
        const outcomeLower = pos.outcome.toLowerCase();
        let outcomeClass = 'yes';
        if (outcomeLower === 'no' || outcomeLower.includes('down') || outcomeLower.includes('否')) {
          outcomeClass = 'no';
        }

        const profitClass = profit >= 0 ? '' : 'loss';
        const profitSign = profit >= 0 ? '+' : '';
        const profitStatusText = profit >= 0 ? '已赢利' : '浮动盈亏';

        const row = document.createElement('div');
        row.className = 'portfolio-item';
        row.innerHTML = `
          <div class="market-details">
            ${iconHtml}
            <div class="market-info">
              <div class="market-title" title="${pos.marketTitle}">${pos.marketTitle}</div>
              <div class="market-outcome-meta">
                <span class="outcome-pill ${outcomeClass}">${pos.outcome}</span>
                <span class="shares-amount">${shares.toFixed(1)} 份额</span>
              </div>
            </div>
          </div>
          <div class="price-compare">
            <span>${formatPrice(avgPrice)}</span>
            <span class="arrow">→</span>
            <span>${formatPrice(currentPrice)}</span>
          </div>
          <div class="value-amount header-col-align-right">$${totalSpent.toFixed(2)}</div>
          <div class="value-amount header-col-align-right">$${potentialProfit.toFixed(2)}</div>
          <div class="profit-col header-col-align-right">
            <span class="profit-badge ${profitClass}">
              ${profit >= 0 ? '✓' : ''} ${profitStatusText}
            </span>
            <span class="profit-value ${profitClass}">
              $${value.toFixed(2)} (${profitSign}${profitPct.toFixed(1)}%)
            </span>
          </div>
          <div class="action-col">
            <button class="btn-redeem" id="redeem-${pos.id}">兑换</button>
            <button class="btn-share" title="分享持仓">
              <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92zM18 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM6 14c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm12 6c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>
            </button>
          </div>
        `;

        listContainer.appendChild(row);

        // Bind Redeem Action
        document.getElementById(`redeem-${pos.id}`).addEventListener('click', () => {
          activeRedeemPosition = { pos, value };
          
          document.getElementById('modal-detail-title').innerText = pos.marketTitle;
          document.getElementById('modal-detail-shares').innerText = `${shares.toFixed(1)} 份额`;
          document.getElementById('modal-detail-price').innerText = `${formatPrice(currentPrice)}/份`;
          document.getElementById('modal-detail-payout').innerText = `$${value.toFixed(2)}`;
          
          modal.classList.add('active');
        });
      }
    });
  }

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

  // Fetch current price via background script to bypass CORS
  async function fetchCurrentPrice(slug, outcome, targetOutcome = '') {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'GET_CURRENT_PRICE',
        slug,
        outcome,
        targetOutcome
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("chrome.runtime.sendMessage error in fetchCurrentPrice:", chrome.runtime.lastError);
          resolve(null);
        } else if (response && response.success) {
          resolve(response.price);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Price formatting helper (e.g. 0.47 -> $0.47, 1.00 -> $1.00)
  function formatPrice(price) {
    if (price === undefined || price === null) return '--';
    return '$' + parseFloat(price).toFixed(2);
  }

  // ----------------------------------------------------
  // 2. DIALOG HISTORY LOGIC
  // ----------------------------------------------------
  function loadHistoryView() {
    const sessionsList = document.getElementById('sessions-list');
    const detailPanel = document.getElementById('history-detail-panel');

    sessionsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--pm-text-secondary); font-size:12px;">加载中...</div>';

    chrome.storage.local.get(['chatHistory'], (items) => {
      const chatHistory = items.chatHistory || [];
      if (chatHistory.length === 0) {
        sessionsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--pm-text-secondary); font-size:12px;">尚无历史对话会话。</div>';
        detailPanel.innerHTML = `
          <div class="history-placeholder">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
            <span>暂无历史对话记录</span>
          </div>
        `;
        return;
      }

      sessionsList.innerHTML = ''; // Clear

      // Sort history: latest first
      const sortedHistory = [...chatHistory].sort((a, b) => b.timestamp - a.timestamp);

      sortedHistory.forEach((session, index) => {
        const item = document.createElement('div');
        item.className = 'session-item';
        if (index === 0) {
          // Select first session by default initially
          item.classList.add('active');
          renderSessionDetail(session);
        }

        // Find preview message
        let previewText = '没有对话消息';
        if (session.messages && session.messages.length > 0) {
          const lastMsg = [...session.messages].reverse().find(m => m.sender === 'user' || m.sender === 'agent');
          if (lastMsg) {
            previewText = lastMsg.payload.text || '订单已生成';
          }
        }

        const dateStr = formatDate(session.timestamp);

        item.innerHTML = `
          <div class="session-item-title" title="${session.marketTitle}">${session.marketTitle}</div>
          <div class="session-item-preview">${previewText}</div>
          <div class="session-item-meta">
            <span>/${session.slug}</span>
            <span>${dateStr}</span>
          </div>
        `;

        item.addEventListener('click', () => {
          // Update active style
          document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          renderSessionDetail(session);
        });

        sessionsList.appendChild(item);
      });
    });
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/`(.*?)`/g, '<code>$1</code>');
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
  }

  function renderSessionDetail(session) {
    const detailPanel = document.getElementById('history-detail-panel');
    const dateFullStr = new Date(session.timestamp).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    detailPanel.innerHTML = `
      <div class="history-detail-header">
        <span class="history-detail-title" title="${session.marketTitle}">${session.marketTitle}</span>
        <span class="history-detail-time">${dateFullStr}</span>
      </div>
      <div class="chat-messages-scroll" id="chat-messages-scroll">
        <!-- Messages render here -->
      </div>
    `;

    const messagesScroll = document.getElementById('chat-messages-scroll');
    if (session.messages && session.messages.length > 0) {
      session.messages.forEach(msg => {
        const timeStr = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        
        if (msg.sender === 'user' || msg.sender === 'agent') {
          const el = document.createElement('div');
          el.className = `pm-msg ${msg.sender}`;
          el.innerHTML = `
            <div class="pm-msg-bubble">${formatMarkdown(msg.payload.text || '')}</div>
            <div class="pm-msg-time">${timeStr}</div>
          `;
          messagesScroll.appendChild(el);
        } else if (msg.sender === 'order_confirmation') {
          const order = msg.payload.order;
          if (!order) return;
          const yesNoClass = order.outcome.toLowerCase() === 'yes' ? 'buy' : 'sell';

          const card = document.createElement('div');
          card.className = 'pm-card-order';
          card.innerHTML = `
            <div class="pm-card-header">
              <span>确认订单 (Parsed Order)</span>
              <span class="pm-card-badge ${yesNoClass}">${order.type}</span>
            </div>
            <div class="pm-card-rows">
              <div class="pm-card-row"><span class="pm-card-label">盘口:</span><span class="pm-card-value">${order.marketTitle}</span></div>
              <div class="pm-card-row"><span class="pm-card-label">合约:</span><span class="pm-card-value">${order.outcome}</span></div>
              <div class="pm-card-row"><span class="pm-card-label">方向:</span><span class="pm-card-value">${order.type}</span></div>
              <div class="pm-card-row"><span class="pm-card-label">金额:</span><span class="pm-card-value">${order.amountUSDC} USDC</span></div>
              <div class="pm-card-row"><span class="pm-card-label">限价:</span><span class="pm-card-value">${order.limitPrice ? '$' + order.limitPrice : '市价 (Market)'}</span></div>
              <div class="pm-card-row"><span class="pm-card-label">预估份额:</span><span class="pm-card-value">${order.estShares} 股</span></div>
            </div>
          `;
          messagesScroll.appendChild(card);
        } else if (msg.sender === 'order_receipt') {
          const receipt = msg.payload.receipt;
          if (!receipt) return;
          const modeStr = receipt.isSimulation ? '模拟仿真' : '实盘交易';

          const card = document.createElement('div');
          card.className = 'pm-card-receipt';
          card.innerHTML = `
            <div class="pm-card-header receipt">
              <span>✓ 订单执行成功</span>
              <span class="pm-card-badge buy">${modeStr}</span>
            </div>
            <div class="pm-card-rows">
              <div class="pm-card-row"><span class="pm-card-label">成交份额:</span><span class="pm-card-value">${receipt.shares} 股</span></div>
              <div class="pm-card-row"><span class="pm-card-label">成交均价:</span><span class="pm-card-value">${formatPrice(parseFloat(receipt.avgPrice))}</span></div>
              <div class="pm-card-row"><span class="pm-card-label">实付金额:</span><span class="pm-card-value">${receipt.totalSpent} USDC</span></div>
              <div class="pm-card-row"><span class="pm-card-label">交易哈希:</span><span class="pm-card-value" style="font-family:monospace; font-size:11px;">${receipt.id}</span></div>
            </div>
          `;
          messagesScroll.appendChild(card);
        } else if (msg.sender === 'order_pending') {
          const receipt = msg.payload.receipt;
          if (!receipt) return;

          const card = document.createElement('div');
          card.className = 'pm-card-receipt';
          card.style.borderColor = 'var(--pm-yellow)';
          card.innerHTML = `
            <div class="pm-card-header" style="color: var(--pm-yellow); border-bottom-color: var(--pm-border);">
              <span>⏰ 限价单已挂起 (Pending)</span>
              <span class="pm-card-badge" style="background-color: rgba(245, 158, 11, 0.1); color: var(--pm-yellow);">限价单</span>
            </div>
            <div class="pm-card-rows">
              <div class="pm-card-row"><span class="pm-card-label">预估份额:</span><span class="pm-card-value">${receipt.shares} 股</span></div>
              <div class="pm-card-row"><span class="pm-card-label">限价价格:</span><span class="pm-card-value">${formatPrice(parseFloat(receipt.avgPrice))}</span></div>
              <div class="pm-card-row"><span class="pm-card-label">锁定金额:</span><span class="pm-card-value">${receipt.totalSpent} USDC</span></div>
              <div class="pm-card-row"><span class="pm-card-label">状态:</span><span class="pm-card-value" style="color: var(--pm-yellow);">等待价格触达限价目标</span></div>
            </div>
          `;
          messagesScroll.appendChild(card);
        }
      });
    }

    // Scroll chat detail to bottom
    messagesScroll.scrollTop = messagesScroll.scrollHeight;
  }

  // Date formatting (MM-DD HH:MM)
  function formatDate(timestamp) {
    const d = new Date(timestamp);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
  }
});
