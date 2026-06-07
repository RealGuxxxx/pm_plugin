/* Polymarket AI Agent Extension Content Script */

(function () {
  // Prevent double injection
  if (window.pmAgentInjected) return;
  window.pmAgentInjected = true;

  let isSimulation = true;
  let marketTitle = '';
  let watchdogTimer = null;
  let parentObserver = null;
  let globalBodyObserver = null;
  let hideButtonsScheduled = false;
  const sidebarWidth = 340; // Custom AI Agent Console width

  // Cached DOM elements to survive React re-renders without state loss
  let agentCardInstance = null;
  let inPageBtnInstance = null;
  let analysisCardInstance = null;
  let isAnalysisOpen = false;
  let sidebarParentInstance = null;
  let activeOutcome = '';
  let currentSessionId = null;

  function logChatToStorage(sender, payload) {
    if (!currentSessionId) {
      currentSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    const pathParts = window.location.pathname.split('/');
    const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'unknown';

    chrome.runtime.sendMessage({
      type: 'LOG_CHAT_MESSAGE',
      sessionId: currentSessionId,
      marketTitle: marketTitle || 'This Market',
      slug: slug,
      sender: sender,
      payload: payload
    });
  }

  let activeState = false;

  function checkAgentState() {
    chrome.storage.local.get(['extensionEnabled'], (items) => {
      const shouldBeActive = items.extensionEnabled !== false;
      if (shouldBeActive) {
        if (!activeState) {
          activeState = true;
          console.log("[Polymarket AI Agent] Activating AI Agent...");
          startAgent();
        } else {
          loadConfig();
        }
      } else {
        if (activeState) {
          activeState = false;
          console.log("[Polymarket AI Agent] Deactivating AI Agent...");
          stopAgent();
        }
      }
    });
  }

  function handleGlobalClickForOutcome() {
    setTimeout(updateActiveOutcome, 100);
    setTimeout(updateActiveOutcome, 300);
    setTimeout(updateActiveOutcome, 600);
  }

  function startAgent() {
    if (!watchdogTimer) {
      watchdogTimer = setInterval(() => {
        mountInlineAgent();
        injectCommentsAnalysis();
      }, 500);
    }
    startGlobalButtonObserver();
    document.addEventListener('click', handleGlobalClickForOutcome);
    mountInlineAgent();
    injectCommentsAnalysis();
  }

  function stopAgent() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    stopGlobalButtonObserver();
    document.removeEventListener('click', handleGlobalClickForOutcome);
    
    if (agentCardInstance) {
      agentCardInstance.remove();
      agentCardInstance = null;
    }
    if (inPageBtnInstance) {
      inPageBtnInstance.remove();
      inPageBtnInstance = null;
    }
    if (analysisCardInstance) {
      analysisCardInstance.remove();
      analysisCardInstance = null;
      isAnalysisOpen = false;
    }
    restoreNativeTradeCard();
  }

  function restoreNativeTradeCard() {
    const nativeCard = findTradeCardContainer();
    if (nativeCard) {
      nativeCard.style.removeProperty('display');
      nativeCard.style.removeProperty('flex-direction');
      nativeCard.style.removeProperty('width');
      nativeCard.style.removeProperty('max-width');
      nativeCard.style.removeProperty('min-width');
      nativeCard.style.removeProperty('padding');
      
      const children = Array.from(nativeCard.children);
      children.forEach(child => {
        child.style.removeProperty('display');
      });
    }

    if (sidebarParentInstance) {
      sidebarParentInstance.style.removeProperty('width');
      sidebarParentInstance.style.removeProperty('min-width');
      sidebarParentInstance.style.removeProperty('max-width');
      sidebarParentInstance.style.removeProperty('overflow');
    }

    const elements = document.querySelectorAll('button, a, div[role="button"]');
    elements.forEach(el => {
      if (el.style.getPropertyValue('display') === 'none') {
        el.style.removeProperty('display');
      }
    });

    const leftCol = document.getElementById('event-detail-container');
    if (leftCol) {
      leftCol.style.removeProperty('--event-detail-width');
      leftCol.style.removeProperty('width');
    }
  }

  // Initialize
  function init() {
    checkAgentState();
  }

  // Global message listener
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
      checkAgentState();
    }
  });

  // Find all "Buy YES" and "Buy NO" buttons on the page and hide them instantly
  function hideAllMarketButtons() {
    if (hideButtonsScheduled) return;
    hideButtonsScheduled = true;

    // Use requestAnimationFrame to debounce layout queries to run at most once per frame
    requestAnimationFrame(() => {
      const elements = document.querySelectorAll('button, a, div[role="button"]');
      elements.forEach(el => {
        const text = el.innerText || '';
        
        // Matches "买入 是...", "Buy Yes...", "买入 否...", "Buy No..."
        const isBuyYes = text.includes('买入 是') || text.includes('Buy Yes') || text.includes('Buy YES');
        const isBuyNo = text.includes('买入 否') || text.includes('Buy No') || text.includes('Buy NO');
        
        if (isBuyYes || isBuyNo) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
      hideButtonsScheduled = false;
    });
  }

  // Monitor DOM body changes to hide dynamically added buttons
  function startGlobalButtonObserver() {
    if (globalBodyObserver) return;
    
    hideAllMarketButtons();

    globalBodyObserver = new MutationObserver(() => {
      hideAllMarketButtons();
    });

    globalBodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function stopGlobalButtonObserver() {
    if (globalBodyObserver) {
      globalBodyObserver.disconnect();
      globalBodyObserver = null;
    }
  }

  // Find Polymarket Trade Card container dynamically using heuristic analysis
  function findTradeCardContainer() {
    const buttons = Array.from(document.querySelectorAll('button, div, span'));
    
    const possibleTabs = buttons.filter(el => {
      if (el.children.length > 0) return false; // leaf nodes only
      const text = el.textContent ? el.textContent.trim() : '';
      return text === '买入' || text === 'Buy' || text === '卖出' || text === 'Sell';
    });

    for (const tab of possibleTabs) {
      let parent = tab.parentElement;
      while (parent && parent !== document.body) {
        const rect = parent.getBoundingClientRect();
        const text = parent.textContent || '';
        
        const hasTradeContext = text.includes('金额') || text.includes('Amount') || 
                                text.includes('份额') || text.includes('Shares') || 
                                text.includes('限价') || text.includes('Limit') || 
                                text.includes('市价') || text.includes('Market') || 
                                text.includes('USDC') || text.includes('过期') || 
                                text.includes('Expiration');
        const hasExecute = text.includes('交易') || text.includes('Buy') || text.includes('Sell') || 
                           text.includes('Log In') || text.includes('登入') || text.includes('登陆') || 
                           text.includes('注册') || text.includes('Connect') || text.includes('连接');
        
        if (hasTradeContext && hasExecute && rect.width < 460 && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    // Fallback: search by "金额" / "Amount" / "份额" / "Shares" label
    const amountLabels = buttons.filter(el => {
      if (el.children.length > 0) return false;
      const text = el.textContent ? el.textContent.trim() : '';
      return text === '金额' || text === 'Amount' || text === '份额' || text === 'Shares';
    });

    for (const label of amountLabels) {
      let parent = label.parentElement;
      while (parent && parent !== document.body) {
        const rect = parent.getBoundingClientRect();
        const text = parent.textContent || '';
        const hasExecute = text.includes('交易') || text.includes('Buy') || text.includes('Sell') || 
                           text.includes('Log In') || text.includes('登入') || text.includes('登陆');
        
        if (hasExecute && rect.width < 460 && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    const aside = document.querySelector('aside');
    if (aside) return aside;

    return null;
  }

  // Scrape page for the prediction market topic
  function extractMarketTitle() {
    const selectors = [
      'h1', 
      '[class*="styles__Title"]', 
      '[class*="EventTitle"]', 
      'meta[property="og:title"]',
      'title'
    ];
    
    for (const selector of selectors) {
      if (selector.startsWith('meta')) {
        const meta = document.querySelector(selector);
        if (meta && meta.content) {
          return meta.content.replace(' | Polymarket', '').trim();
        }
      } else {
        const el = document.querySelector(selector);
        if (el && el.innerText) {
          const text = el.innerText.trim();
          if (text) return text;
        }
      }
    }
    return 'This Market';
  }

  // Centralized dark mode detection
  function isDarkMode() {
    // 1. Check classes or attributes on documentElement or body first
    const isDarkClass = document.documentElement.classList.contains('dark') || 
                        (document.body && document.body.classList.contains('dark')) ||
                        document.documentElement.getAttribute('data-theme') === 'dark' ||
                        (document.body && document.body.getAttribute('data-theme') === 'dark');
    if (isDarkClass) return true;

    // 2. Check computed background colors of body or root
    const bodyBg = document.body ? window.getComputedStyle(document.body).backgroundColor : '';
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    
    const checkBg = (bg) => {
      if (!bg || bg === 'transparent' || bg.includes('rgba(0, 0, 0, 0)')) return false;
      const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance < 80; // low luminance indicates dark mode
      }
      return false;
    };
    
    return checkBg(bodyBg) || checkBg(htmlBg);
  }

  // Automatically detect dark/light theme of the Polymarket page
  function detectTheme(cardElement) {
    if (!cardElement) return;
    const isDark = isDarkMode();
    cardElement.classList.remove('theme-dark', 'theme-light');
    cardElement.classList.add(isDark ? 'theme-dark' : 'theme-light');
  }

  // Helper to find the active market from the accordion component on the page
  function findActiveMarketFromAccordion() {
    const openAccordion = document.querySelector('[data-state="open"][data-scroll-anchor*="event-detail-accordion-item"]');
    if (!openAccordion) return '';
    
    // Attempt 1: Get the clean title from the heading paragraph inside the accordion header
    const pEl = openAccordion.querySelector('p[class*="text-heading-lg"]') || 
                openAccordion.querySelector('p[class*="font-semibold"]') || 
                openAccordion.querySelector('p');
    if (pEl) {
      let txt = (pEl.innerText || pEl.textContent || '').trim();
      txt = txt.split('\n')[0].trim();
      txt = cleanMarketTitle(txt);
      if (txt && txt.length < 60 && !txt.includes('¢') && !txt.includes('%') && !txt.includes('交易量')) {
        return txt;
      }
    }
    
    // Attempt 2: Get trigger/button text inside the accordion header
    const trigger = openAccordion.querySelector('button, [role="button"], h2, h3, h4');
    if (trigger) {
      let txt = (trigger.innerText || trigger.textContent || '').trim();
      const textSpan = trigger.querySelector('span, div');
      if (textSpan && textSpan.innerText) {
        const spanTxt = textSpan.innerText.trim();
        if (spanTxt && spanTxt.length > 1 && !spanTxt.includes('¢') && !spanTxt.includes('%')) {
          txt = spanTxt;
        }
      }
      
      txt = txt.split('\n')[0].trim();
      txt = cleanMarketTitle(txt);
      if (txt && txt.length < 60) {
        return txt;
      }
    }

    // Attempt 3: Fallback to parsing from data-scroll-anchor slug
    const anchor = openAccordion.getAttribute('data-scroll-anchor') || '';
    const match = anchor.match(/^event-detail-accordion-item-\d+-(.+)-\d+$/) || anchor.match(/^event-detail-accordion-item-(.+)$/);
    if (match && match[1]) {
      let slug = match[1];
      slug = slug.replace(/^\d+-/, ''); // remove any leading digits if present
      const readable = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return readable;
    }
    
    return '';
  }

  // Helper to strip prices/cents/percentages from titles
  function cleanMarketTitle(title) {
    if (!title) return '';
    return title
      .replace(/\s*\d+(\.\d+)?(¢|%|\$|c)\s*$/gi, '')
      .replace(/\s*-\s*$/, '')
      .trim();
  }

  // Helper to find the active date row from the left side of the screen
  function findActiveDateFromLeft() {
    const elements = Array.from(document.querySelectorAll('*'));
    // Find leaf elements containing date pattern
    const dateElements = elements.filter(el => {
      if (el.children.length > 0) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return /\d+月\d+日/.test(text) && text.length < 15;
    });
    
    for (const el of dateElements) {
      let p = el;
      // Walk up to find if the row container is selected
      for (let i = 0; i < 5 && p; i++) {
        const style = window.getComputedStyle(p);
        const bg = style.backgroundColor || '';
        const border = style.border || style.borderColor || '';
        const cls = (p.className || '').toString().toLowerCase();
        
        const isGreen = bg.includes('16, 185, 129') || bg.includes('34, 197, 94') || bg.includes('0, 192, 115');
        const isRed = bg.includes('239, 68, 68') || bg.includes('244, 63, 94');
        const isBlue = bg.includes('0, 75, 255') || bg.includes('59, 130, 246') || bg.includes('30, 58, 138') || bg.includes('224, 231, 255') || bg.includes('219, 234, 254');
        
        // Check for common selection backgrounds
        const isSelectedBg = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && 
                             !bg.includes('255, 255, 255') && !bg.includes('0, 0, 0, 0') &&
                             (bg.includes('241, 245, 249') || bg.includes('237, 242, 249') || bg.includes('30, 41, 59') || bg.includes('15, 23, 42') || bg.includes('51, 65, 85'));
        
        const isActiveClass = cls.includes('active') || cls.includes('selected') || cls.includes('expanded') || cls.includes('current') || cls.includes('focus');
        const isAttrSelected = p.getAttribute('aria-selected') === 'true' || p.getAttribute('data-state') === 'active';
        const hasActiveBorder = border.includes('rgb(0, 75, 255)') || border.includes('rgb(16, 185, 129)') || border.includes('rgb(34, 197, 94)');
        
        if (isGreen || isRed || isBlue || isSelectedBg || isActiveClass || isAttrSelected || hasActiveBorder) {
          return el.innerText.trim();
        }
        p = p.parentElement;
      }
    }
    return '';
  }

  // Helper to find which option (Yes/No) is currently active inside the trade card
  function getActiveSelectionFromTradeCard() {
    const nativeCard = findTradeCardContainer();
    if (!nativeCard) return '是';
    
    const allEls = Array.from(nativeCard.querySelectorAll('*'));
    const selectorEls = allEls.filter(el => {
      if (el.children.length > 0) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return text.includes('是') || text.includes('否') || text.includes('Yes') || text.includes('No');
    });
    
    for (const el of selectorEls) {
      let p = el;
      for (let i = 0; i < 5 && p; i++) {
        const style = window.getComputedStyle(p);
        const bg = style.backgroundColor || '';
        const cls = (p.className || '').toString().toLowerCase();
        
        const isGreen = bg.includes('16, 185, 129') || bg.includes('34, 197, 94') || bg.includes('0, 192, 115');
        const isRed = bg.includes('239, 68, 68') || bg.includes('244, 63, 94');
        const isBlue = bg.includes('0, 75, 255') || bg.includes('59, 130, 246');
        const isActiveClass = cls.includes('selected') || cls.includes('active') || cls.includes('checked');
        const isAttrSelected = p.getAttribute('aria-selected') === 'true' || p.getAttribute('data-state') === 'active';
        
        if (isGreen || isRed || isBlue || isActiveClass || isAttrSelected) {
          const textVal = el.innerText || el.textContent || '';
          const match = textVal.trim().match(/(是|否|Yes|No)/i);
          if (match) return match[0];
        }
        p = p.parentElement;
      }
    }
    return '是';
  }

  // Extract active outcome text directly by combining left side selected date/market and card Yes/No tab
  function extractActiveOutcomeFromHeader() {
    let activeMarket = findActiveMarketFromAccordion();
    if (!activeMarket) {
      activeMarket = findActiveDateFromLeft();
    }
    
    if (activeMarket) {
      const m = activeMarket.trim().toLowerCase();
      // If the sub-market label is just a binary word, don't display it
      const isBinaryLabel = ['yes', 'no', '是', '否', 'yes/no'].includes(m);
      if (isBinaryLabel) {
        return '';
      }
      return activeMarket;
    }
    return '';
  }

  function extractPricesFromDOM() {
    const openAccordion = document.querySelector('[data-state="open"][data-scroll-anchor*="event-detail-accordion-item"]');
    if (!openAccordion) return null;
    
    let yesPrice = null;
    let noPrice = null;
    
    const buttons = Array.from(openAccordion.querySelectorAll('button, a, div[role="button"]'));
    for (const btn of buttons) {
      const text = (btn.innerText || btn.textContent || '').trim();
      const isYes = text.toLowerCase().includes('yes') || text.includes('是');
      const isNo = text.toLowerCase().includes('no') || text.includes('否');
      
      const priceMatch = text.match(/(\d+(?:\.\d+)?)\s*(¢|c|\$)/i) || text.match(/(?:\$)\s*(\d+(?:\.\d+)?)/i);
      if (priceMatch) {
        let val = parseFloat(priceMatch[1]);
        if (text.includes('¢') || text.includes('c')) {
          val = val / 100;
        }
        if (isYes && !isNo) {
          yesPrice = val;
        } else if (isNo) {
          noPrice = val;
        }
      }
    }
    
    if (yesPrice !== null || noPrice !== null) {
      return { yes: yesPrice, no: noPrice };
    }
    return null;
  }

  // Scan orderbooks and hidden native elements to identify the active outcome being selected/expanded
  function updateActiveOutcome() {
    let outcome = extractActiveOutcomeFromHeader();
    
    if (!outcome) {
      // Fallback: Heuristic 1: Scan for the expanded visible orderbook container's parent title
      const visibleOrderbooks = Array.from(document.querySelectorAll('[class*="Table"], [class*="OrderBook"], [class*="Orderbook"]')).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      for (const ob of visibleOrderbooks) {
        let parent = ob.parentElement;
        while (parent && parent !== document.body) {
          const headers = Array.from(parent.querySelectorAll('h2, h3, h4, [class*="Title"], [class*="Header"], [class*="OutcomeName"]'));
          for (const h of headers) {
            const text = h.innerText ? h.innerText.trim() : '';
            if (text && text.length < 30 && 
                !text.includes('价格') && !text.includes('份额') && !text.includes('总计') && 
                !text.includes('TRADE') && !text.includes('交易') && !text.includes('最新') &&
                !text.includes('点差') && !text.includes('订单')) {
              outcome = text;
              break;
            }
          }
          if (outcome) break;
          parent = parent.parentElement;
        }
        if (outcome) break;
      }
    }

    if (outcome !== activeOutcome) {
      activeOutcome = outcome;
      console.log(`[Polymarket AI Agent] Detected active outcome change: "${activeOutcome}"`);
      updateTargetOutcomeUI();
    }
  }

  // Helper to truncate long active outcome strings while preserving option suffix (e.g., "• 是")
  function truncateOutcomeText(text, maxLen = 20) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    const optionMatch = text.match(/\s*•\s*(是|否|Yes|No)$/i);
    if (optionMatch) {
      const optionPart = optionMatch[0]; // e.g. " • 是"
      const baseLen = maxLen - optionPart.length;
      if (baseLen > 5) {
        return text.substring(0, baseLen) + '...' + optionPart;
      }
    }
    return text.substring(0, maxLen - 3) + '...';
  }

  // Update target outcome badge dynamically in the UI
  function updateTargetOutcomeUI() {
    const badge = document.getElementById('pm-agent-target-outcome');
    const textEl = document.getElementById('pm-agent-target-outcome-text');
    if (badge && textEl) {
      if (activeOutcome) {
        textEl.innerText = truncateOutcomeText(activeOutcome, 20);
        badge.setAttribute('title', activeOutcome); // hover to see full description
        badge.style.setProperty('display', 'inline-flex', 'important');
      } else {
        badge.style.setProperty('display', 'none', 'important');
      }
    }
  }

  let eventDetailObserverInstance = null;
  let observedContainerInstance = null;

  function observeEventDetailContainer(container, parent) {
    if (observedContainerInstance === container) return;

    if (eventDetailObserverInstance) {
      eventDetailObserverInstance.disconnect();
    }

    observedContainerInstance = container;
    eventDetailObserverInstance = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        eventDetailObserverInstance.disconnect();
        eventDetailObserverInstance = null;
        observedContainerInstance = null;
        return;
      }

      eventDetailObserverInstance.disconnect();
      adjustLayout(parent);
      eventDetailObserverInstance.observe(container, {
        attributes: true,
        attributeFilter: ['style']
      });
    });

    eventDetailObserverInstance.observe(container, {
      attributes: true,
      attributeFilter: ['style']
    });
  }

  // Adjust layout dimensions of left container and sidebar parent to fit perfectly
  function adjustLayout(parent) {
    if (!parent) return;

    // 1. Set sidebar parent width
    parent.style.setProperty('width', `${sidebarWidth}px`, 'important');
    parent.style.setProperty('min-width', `${sidebarWidth}px`, 'important');
    parent.style.setProperty('max-width', `${sidebarWidth}px`, 'important');
    parent.style.setProperty('overflow', 'hidden', 'important');

    // 2. Adjust `--event-detail-width` on the left container `#event-detail-container`
    const eventDetailContainer = document.getElementById('event-detail-container') || parent.previousElementSibling;
    if (eventDetailContainer) {
      // Polymarket uses calc(100vw - 24px - 24px - 340px - 24px) where 340px is native sidebar width.
      // We align it using our sidebarWidth (340px).
      const expectedVal = `calc(100vw - 24px - 24px - ${sidebarWidth}px - 24px)`;
      const currentVal = eventDetailContainer.style.getPropertyValue('--event-detail-width') || '';
      // Check if already set to our sidebarWidth value
      const isAlreadyCustom = currentVal.includes(`${sidebarWidth}px`) || currentVal.includes('340px');
      if (!isAlreadyCustom) {
        eventDetailContainer.style.setProperty('--event-detail-width', expectedVal, 'important');
      }
      
      // Start observing style changes on `#event-detail-container` to override React resets instantly
      observeEventDetailContainer(eventDetailContainer, parent);
    }

    // 3. Walk up ancestors to resize any CSS Grid columns holding the sidebar (only on desktop >= 1024px)
    if (window.innerWidth >= 1024) {
      let ancestor = parent;
      while (ancestor && ancestor !== document.body) {
        try {
          const computed = window.getComputedStyle(ancestor);
          if (computed && computed.display === 'grid') {
            ancestor.style.setProperty('grid-template-columns', `1fr ${sidebarWidth}px`, 'important');
            ancestor.style.setProperty('grid-template-columns', `minmax(0, 1fr) ${sidebarWidth}px`, 'important');
          }
        } catch (e) {
          // ignore style read errors
        }
        ancestor = ancestor.parentElement;
      }
    }
  }

  // Helper to find and hide tabs inside the header container
  function hideTabSelectorInsideHeader(headerEl) {
    if (!headerEl) return;
    
    // 1. Expand the keywords list to cover all potential trade tab options
    const tabKeywords = [
      '买入', '卖出', '限价', '市价', '盘口', '交易',
      'buy', 'sell', 'limit', 'market', 'order book', 'orderbook', 'activity'
    ];
    
    // Find all leaf elements (or elements with no child elements, or small wrappers containing exactly one of the keywords)
    const elements = Array.from(headerEl.querySelectorAll('*'));
    
    const matchedLeaves = elements.filter(el => {
      const childCount = el.children.length;
      if (childCount > 0) {
        if (childCount > 2) return false;
      }
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (text.length === 0 || text.length > 15) return false;
      
      const isTabKeyword = tabKeywords.includes(text);
      const isPriceOutcome = (text.includes('是') || text.includes('否') || text.includes('yes') || text.includes('no')) && 
                             (text.includes('¢') || text.includes('$') || text.includes('%') || text.includes('c'));
      
      return isTabKeyword || isPriceOutcome;
    });

    if (matchedLeaves.length === 0) return;

    // For each matched leaf, walk up to find the container to hide
    const hiddenContainers = new Set();
    
    matchedLeaves.forEach(leaf => {
      let curr = leaf;
      let containerToHide = leaf;
      
      while (curr && curr !== headerEl) {
        const text = (curr.innerText || '').toLowerCase();
        
        // 1. If it contains the market title, it's too high! Stop.
        if (marketTitle && text.includes(marketTitle.substring(0, 10).toLowerCase())) {
          break;
        }
        
        // 2. If it contains the outcome date indicator, it's too high! Stop.
        if (text.includes('•') || /\d+月\d+日/.test(text)) {
          break;
        }
        
        // 3. Keep updating the container we want to hide
        containerToHide = curr;
        curr = curr.parentElement;
      }
      
      if (containerToHide && !hiddenContainers.has(containerToHide)) {
        containerToHide.style.setProperty('display', 'none', 'important');
        hiddenContainers.add(containerToHide);
      }
    });
  }

  // Helper to find and hide Yes/No price buttons inside the native trade card container
  function hidePriceOutcomeButtons(nativeCard) {
    if (!nativeCard) return;
    
    // Find all leaf elements containing Yes/No and price/cent indicators
    const allEls = Array.from(nativeCard.querySelectorAll('*'));
    const selectorsToHide = allEls.filter(el => {
      if (el.children.length > 0) return false; // leaf elements only
      const txt = (el.innerText || el.textContent || '').trim();
      return (txt.includes('是') || txt.includes('否') || txt.includes('Yes') || txt.includes('No')) && 
             (txt.includes('¢') || txt.includes('$') || txt.includes('%') || txt.includes('c') || txt.includes('¢'));
    });
    
    selectorsToHide.forEach(el => {
      let p = el;
      for (let i = 0; i < 4 && p && p !== nativeCard; i++) {
        if (p === agentCardInstance) break;
        
        const pText = (p.innerText || '').trim();
        // Stop walking up if we reach the header containing title or outcome date
        if (marketTitle && pText.toLowerCase().includes(marketTitle.substring(0, 8).toLowerCase())) {
          break;
        }
        if (pText.includes('•') || /\d+月\d+日/.test(pText)) {
          break;
        }
        
        p.style.setProperty('display', 'none', 'important');
        p = p.parentElement;
      }
    });
  }

  // Hide all native trade card elements and header completely, keeping only our agent card visible
  function hideNativeTradeFormAndInjectAgent(nativeCard) {
    if (!nativeCard) return;

    // 1. Ensure the nativeCard wrapper itself is displayed as a flex container and stretches fully, and remove native padding
    nativeCard.style.setProperty('display', 'flex', 'important');
    nativeCard.style.setProperty('flex-direction', 'column', 'important');
    nativeCard.style.setProperty('width', '100%', 'important');
    nativeCard.style.setProperty('max-width', '100%', 'important');
    nativeCard.style.setProperty('min-width', '100%', 'important');
    nativeCard.style.setProperty('box-sizing', 'border-box', 'important');
    nativeCard.style.setProperty('padding', '0px', 'important');
    nativeCard.style.setProperty('overflow', 'hidden', 'important');

    // 2. Hide all native children, leaving only our agent card visible
    const children = Array.from(nativeCard.children);
    children.forEach(child => {
      if (child !== agentCardInstance) {
        child.style.setProperty('display', 'none', 'important');
      }
    });
  }

  // Replace native Trade Card body with our inline Chat Console
  function mountInlineAgent() {
    const nativeCard = findTradeCardContainer();
    let parent = nativeCard ? nativeCard.parentNode : null;

    if (!parent && sidebarParentInstance && document.body.contains(sidebarParentInstance)) {
      parent = sidebarParentInstance;
    }

    if (!parent) return;

    // Keep parent reference cached to survive dynamic trade card updates in watchdog runs
    sidebarParentInstance = parent;

    // Hide buy YES/NO buttons
    hideAllMarketButtons();

    // Adjust layout width settings for parent and left column
    adjustLayout(parent);

    // Check if our card instance already exists
    if (agentCardInstance) {
      // Ensure we keep the theme up to date dynamically
      detectTheme(agentCardInstance);

      // If it's already in the DOM and is a child of the correct parent, check if title changed
      if (document.body.contains(agentCardInstance) && agentCardInstance.parentNode === nativeCard) {
        // Even when returning early, re-verify layout width and observers in case of React DOM reset
        adjustLayout(parent);
        if (nativeCard) {
          hideNativeTradeFormAndInjectAgent(nativeCard);
        }
        updateActiveOutcome();

        const currentTitle = extractMarketTitle();
        if (currentTitle !== marketTitle && currentTitle !== 'This Market') {
          marketTitle = currentTitle;
          console.log(`[Polymarket AI Agent] Market title changed to: "${marketTitle}". Resetting chat.`);
          resetChatConsole();
        }
        return;
      }
      
      // If it was detached or parent changed (due to React re-render), insert/re-insert it
      console.log("[Polymarket AI Agent] Re-inserting cached agentCardInstance...");
      if (nativeCard) {
        hideNativeTradeFormAndInjectAgent(nativeCard);
        nativeCard.appendChild(agentCardInstance);
        updateActiveOutcome();
        updateTargetOutcomeUI();
      }
      return;
    }

    console.log("[Polymarket AI Agent] Native trade card found! Injecting AI Agent Console...");
    marketTitle = extractMarketTitle();

    // Create custom inline card container
    agentCardInstance = document.createElement('div');
    agentCardInstance.className = 'pm-agent-card-inlined';
    
    agentCardInstance.innerHTML = `
      <!-- Status Line -->
      <div class="pm-agent-status-line" style="display: flex; gap: 8px; align-items: center; padding: 12px 16px 0 16px;">
        <span class="pm-agent-status-badge simulation" id="pm-agent-status">
          <span class="pm-agent-status-dot"></span>
          <span id="pm-agent-status-text">Sim</span>
        </span>
        <span class="pm-agent-target-badge" id="pm-agent-target-outcome" style="display: none;">
          🎯 <span id="pm-agent-target-outcome-text"></span>
        </span>
      </div>

      <!-- Chat Terminal -->
      <div class="pm-agent-view" id="pm-agent-view-chat">
        <div class="pm-agent-chat-history" id="pm-agent-chat-history"></div>
        
        <div class="pm-agent-input-container">
          <div class="pm-agent-textarea-wrapper">
            <textarea class="pm-agent-input" id="pm-agent-chat-input" placeholder="输入交易指令 (如: 买入 10 USDC)" rows="1"></textarea>
            <button class="pm-agent-send-btn" id="pm-agent-send-btn">
              <svg viewBox="0 0 24 24">
                <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>
              </svg>
            </button>
          </div>
          <div class="pm-agent-input-hint">
            交易由 AI 解析。请在确认单生成后核对无误再执行。
          </div>
        </div>
      </div>
    `;

    // Apply transparent styles to agentCardInstance to inherit native border and card colors
    agentCardInstance.style.setProperty('background', 'transparent', 'important');
    agentCardInstance.style.setProperty('border', 'none', 'important');
    agentCardInstance.style.setProperty('box-shadow', 'none', 'important');
    agentCardInstance.style.setProperty('padding', '0', 'important');
    agentCardInstance.style.setProperty('margin', '0', 'important');
    agentCardInstance.style.setProperty('width', '100%', 'important');

    if (nativeCard) {
      hideNativeTradeFormAndInjectAgent(nativeCard);
      nativeCard.appendChild(agentCardInstance);
    }

    detectTheme(agentCardInstance);
    setupCardEventListeners(agentCardInstance);
    loadConfig();
    renderMonicaWelcomeDashboard();
    updateActiveOutcome();

    // Start MutationObserver on parent container to override React dynamic updates in real-time
    setupParentObserver(parent, nativeCard);
  }

  // Setup observer on the parent element
  function setupParentObserver(parent, initialNativeCard) {
    if (parentObserver) {
      parentObserver.disconnect();
    }

    let targetCard = initialNativeCard;

    parentObserver = new MutationObserver((mutations) => {
      // 1. Adjust layout width settings for parent and left column
      adjustLayout(parent);

      // 2. Hide native trade form elements and keep native header visible
      if (targetCard) {
        hideNativeTradeFormAndInjectAgent(targetCard);
      }

      // 3. If React destroys and creates a new node, find it and hide it instantly
      const currentNativeCard = findTradeCardContainer();
      if (currentNativeCard && currentNativeCard !== targetCard) {
        console.log("[Polymarket AI Agent] React re-created native card. Re-applying custom layout.");
        targetCard = currentNativeCard;
        hideNativeTradeFormAndInjectAgent(targetCard);
      }
      
      // Hide all YES/NO buttons
      hideAllMarketButtons();
    });

    // Watch for style changes, class name modifications, and child element insertion
    parentObserver.observe(parent, { 
      childList: true, 
      subtree: true, 
      attributes: true, 
      attributeFilter: ['style', 'class'] 
    });
  }

  // Load configuration details for badge
  function loadConfig() {
    chrome.storage.local.get(['liveMode', 'liveAddress'], (items) => {
      isSimulation = !items.liveMode || !items.liveAddress;
      
      const badge = document.getElementById('pm-agent-status');
      const text = document.getElementById('pm-agent-status-text');
      
      if (badge && text) {
        badge.className = 'pm-agent-status-badge ' + (isSimulation ? 'simulation' : 'live');
        text.innerText = isSimulation ? 'Sim' : 'Live';
      }
    });
  }

  // Reset chat console state
  function resetChatConsole() {
    const history = document.getElementById('pm-agent-chat-history');
    if (history) history.innerHTML = '';
    currentSessionId = null; // Start a new chat session when console is reset
    renderMonicaWelcomeDashboard();
  }

  // Render Monica-style Welcome Dashboard when chat history is empty
  function renderMonicaWelcomeDashboard() {
    const history = document.getElementById('pm-agent-chat-history');
    if (!history) return;

    history.innerHTML = `
      <div class="pm-agent-monica-dashboard" id="pm-agent-monica-dashboard">
        <div class="pm-agent-monica-header">
          <div class="pm-agent-monica-avatar">
            <svg viewBox="0 0 24 24">
              <path d="M19,8H17.82A4.89,4.89,0,0,0,13,4V3a1,1,0,0,0-2,0V4A4.89,4.89,0,0,0,6.18,8H5a3,3,0,0,0-3,3v3a3,3,0,0,0,3,3H6.18A4.89,4.89,0,0,0,11,20v1a1,1,0,0,0,2,0V20a4.89,4.89,0,0,0,4.82-3H19a3,3,0,0,0,3-3V11A3,3,0,0,0,19,8ZM11,6A2.9,2.9,0,0,1,13.8,8.7L12,10.5,10.2,8.7A2.9,2.9,0,0,1,11,6ZM5,15a1,1,0,0,1-1-1V11a1,1,0,0,1,1-1H6v5Zm12,1a2.9,2.9,0,0,1-2.82-2H9.82A2.9,2.9,0,0,1,7,16V10a2.9,2.9,0,0,1,2.82-2h4.36A2.9,2.9,0,0,1,17,10ZM20,14a1,1,0,0,1-1,1H18V10h1a1,1,0,0,1,1,1Z" fill="white"/>
            </svg>
          </div>
          <div class="pm-agent-monica-greeting">你好！我是你的 AI 交易助手，有什么我可以帮助你的吗？</div>
        </div>
        
        <div class="pm-agent-monica-divider"></div>
        
        <div class="pm-agent-monica-section-title">快捷指令 / 建议追加问</div>
        
        <div class="pm-agent-monica-suggestions">
          <div class="pm-agent-monica-suggestion-item" data-prompt="分析这个市场的当前共识与合理走向">
            <div class="pm-agent-suggestion-text-container">
              <span>📈</span>
              <span>分析共识与走势</span>
            </div>
          </div>
          <div class="pm-agent-monica-suggestion-item" data-prompt="我想模拟买入 10 USDC 的 YES">
            <div class="pm-agent-suggestion-text-container">
              <span>💰</span>
              <span>模拟买入 10 USDC</span>
            </div>
          </div>
          <div class="pm-agent-monica-suggestion-item" data-prompt="如何设置预测市场模拟止损订单？">
            <div class="pm-agent-suggestion-text-container">
              <span>🛡️</span>
              <span>设置模拟止损单</span>
            </div>
          </div>
          <div class="pm-agent-monica-suggestion-item" data-action="comments">
            <div class="pm-agent-suggestion-text-container">
              <span>💬</span>
              <span>一键分析舆情(含推特)</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Hook click events on suggestion items
    const itemsSuggestions = history.querySelectorAll('.pm-agent-monica-suggestion-item');
    itemsSuggestions.forEach(item => {
      item.addEventListener('click', (e) => {
        const action = item.getAttribute('data-action');
        const prompt = item.getAttribute('data-prompt');

        if (action === 'comments') {
          scrollToCommentsAndTrigger();
        } else if (prompt) {
          const chatInput = document.getElementById('pm-agent-chat-input');
          if (chatInput) {
            chatInput.value = prompt;
            handleSendMessage();
          }
        }
      });
    });
  }

  // Scroll to comments tab header and trigger click on our analysis button
  function scrollToCommentsAndTrigger() {
    const btn = document.getElementById('pm-agent-in-page-analysis-btn');
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        const card = document.querySelector('.pm-agent-page-analysis-card');
        if (!card) {
          btn.click();
        }
      }, 600);
    } else {
      const commentsTab = findCommentsHeader();
      if (commentsTab) {
        commentsTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // Setup Event Listeners inside card
  function setupCardEventListeners(cardElement) {
    const chatInput = cardElement.querySelector('#pm-agent-chat-input');
    const sendBtn = cardElement.querySelector('#pm-agent-send-btn');

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = (chatInput.scrollHeight - 4) + 'px';
    });

    // Send handlers
    sendBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    // Listen to background updates removed and moved to global
  }

  // Send message processing
  function handleSendMessage() {
    const chatInput = document.getElementById('pm-agent-chat-input');
    const text = chatInput.value.trim();
    if (!text) return;

    const dashboard = document.getElementById('pm-agent-monica-dashboard');
    if (dashboard) {
      dashboard.remove();
    }

    addMessage('user', text);
    chatInput.value = '';
    chatInput.style.height = '';

    const typingId = addTypingIndicator();
    const domPrices = extractPricesFromDOM();

    chrome.runtime.sendMessage({
      type: 'PARSE_ORDER',
      prompt: text,
      marketContext: {
        title: marketTitle,
        activeOutcome: activeOutcome,
        url: window.location.href,
        domPrices: domPrices
      }
    }, (response) => {
      removeTypingIndicator(typingId);
      
      if (chrome.runtime.lastError) {
        addMessage('agent', "Error: Service worker connection failed. Try reloading extension.");
        return;
      }

      if (response && response.error) {
        addMessage('agent', `Error: ${response.error}`);
        return;
      }

      if (response.replyText) {
        addMessage('agent', response.replyText, true);
      }

      if (response.orderParsed && response.order) {
        const pathParts = window.location.pathname.split('/');
        const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
        response.order.slug = slug;
        
        const delay = response.replyText ? (response.replyText.length * 8) : 0;
        setTimeout(() => {
          addOrderConfirmationCard(response.order);
        }, Math.min(delay, 2000));
      }
    });
  }

  // Helper to scroll the chat history to the bottom reliably after rendering ticks
  function scrollToBottom() {
    const history = document.getElementById('pm-agent-chat-history');
    if (history) {
      history.scrollTop = history.scrollHeight;
      setTimeout(() => {
        history.scrollTop = history.scrollHeight;
      }, 50);
      setTimeout(() => {
        history.scrollTop = history.scrollHeight;
      }, 150);
    }
  }

  // Helper to parse simple markdown formatting (bold, italic, code, newlines)
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

  // Helper to add chat bubble with optional typewriter streaming for agent
  function addMessage(sender, text, isStreaming = false) {
    const history = document.getElementById('pm-agent-chat-history');
    if (!history) return;

    const msg = document.createElement('div');
    msg.className = `pm-agent-message ${sender}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'pm-agent-msg-bubble';
    
    const time = document.createElement('div');
    time.className = 'pm-agent-msg-time';
    const now = new Date();
    time.innerText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    msg.appendChild(bubble);
    msg.appendChild(time);
    history.appendChild(msg);

    if (sender === 'agent' && isStreaming && text.length > 0) {
      let currentIndex = 0;
      bubble.innerHTML = '';
      
      const interval = setInterval(() => {
        if (currentIndex < text.length) {
          currentIndex += Math.min(2, text.length - currentIndex);
          bubble.innerHTML = formatMarkdown(text.substring(0, currentIndex));
          scrollToBottom();
        } else {
          clearInterval(interval);
          logChatToStorage(sender, { text: text });
        }
      }, 15);
    } else {
      bubble.innerHTML = formatMarkdown(text);
      scrollToBottom();
      logChatToStorage(sender, { text: text });
    }
  }

  // Typing indicator
  function addTypingIndicator() {
    const history = document.getElementById('pm-agent-chat-history');
    if (!history) return '0';

    const id = 'typing-' + Date.now();
    const msg = document.createElement('div');
    msg.className = 'pm-agent-message agent';
    msg.id = id;

    const bubble = document.createElement('div');
    bubble.className = 'pm-agent-msg-bubble';
    bubble.innerText = 'Analyzing intent...';

    msg.appendChild(bubble);
    history.appendChild(msg);
    scrollToBottom();
    return id;
  }

  function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // Inject Order Confirmation Card inside chat stream
  function addOrderConfirmationCard(order) {
    const history = document.getElementById('pm-agent-chat-history');
    if (!history) return;

    const container = document.createElement('div');
    container.className = 'pm-agent-order-card';
    
    const yesNoClass = order.outcome.toLowerCase() === 'yes' ? 'outcome-yes' : 'outcome-no';
    
    container.innerHTML = `
      <div class="pm-agent-order-card-header">
        <span>Order Confirmation</span>
        <span class="pm-agent-order-type ${order.type.toLowerCase()}">${order.type}</span>
      </div>
      <div class="pm-agent-order-details">
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Asset:</span>
          <span class="pm-agent-order-value">${order.marketTitle || marketTitle}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Outcome:</span>
          <span class="pm-agent-order-value ${yesNoClass}">${order.outcome.toUpperCase()}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Order Type:</span>
          <span class="pm-agent-order-value">${order.priceType}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Amount:</span>
          <span class="pm-agent-order-value">${order.amountUSDC} USDC</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Limit Price:</span>
          <span class="pm-agent-order-value">${order.limitPrice ? '$' + parseFloat(order.limitPrice).toFixed(2) : 'Market'}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Est. Shares:</span>
          <span class="pm-agent-order-value">${order.estShares} Shares</span>
        </div>
      </div>
      <div class="pm-agent-order-actions">
        <button class="pm-agent-order-btn cancel" id="cancel-${order.id}">Cancel</button>
        <button class="pm-agent-order-btn confirm" id="confirm-${order.id}">
          ${isSimulation ? 'Confirm (Sim)' : 'Confirm Order'}
        </button>
      </div>
    `;

    history.appendChild(container);
    scrollToBottom();
    logChatToStorage('order_confirmation', { order: order });

    // Button binders
    document.getElementById(`cancel-${order.id}`).addEventListener('click', () => {
      container.remove();
      addMessage('agent', 'Order cancelled.');
      
      if (history.children.length === 0) {
        renderMonicaWelcomeDashboard();
      }
    });

    document.getElementById(`confirm-${order.id}`).addEventListener('click', () => {
      container.querySelectorAll('.pm-agent-order-btn').forEach(btn => btn.disabled = true);
      container.querySelector(`.confirm`).innerText = 'Executing...';

      order.sessionId = currentSessionId;

      chrome.runtime.sendMessage({
        type: 'EXECUTE_ORDER',
        order: order
      }, (response) => {
        container.remove();
        if (response && response.success) {
          if (response.status === 'pending') {
            addPendingCard(response.receipt);
          } else {
            addReceiptCard(response.receipt);
          }
        } else {
          addMessage('agent', `Failed to execute order: ${response.error || 'Unknown error'}`);
        }
      });
    });
  }

  // Inject success receipt card inside chat stream
  function addReceiptCard(receipt) {
    const history = document.getElementById('pm-agent-chat-history');
    if (!history) return;

    const container = document.createElement('div');
    container.className = 'pm-agent-receipt-card';

    container.innerHTML = `
      <div class="pm-agent-receipt-title">
        <svg viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <span>Order Executed!</span>
      </div>
      <div class="pm-agent-order-details">
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Shares:</span>
          <span class="pm-agent-order-value">${receipt.shares}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Avg Price:</span>
          <span class="pm-agent-order-value">$${parseFloat(receipt.avgPrice).toFixed(2)}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Total Spent:</span>
          <span class="pm-agent-order-value">${receipt.totalSpent} USDC</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Mode:</span>
          <span class="pm-agent-order-value">${receipt.isSimulation ? 'Simulated' : 'Live'}</span>
        </div>
      </div>
    `;

    history.appendChild(container);
    scrollToBottom();
    logChatToStorage('order_receipt', { receipt: receipt });
  }

  // Inject pending limit order card inside chat stream
  function addPendingCard(receipt) {
    const history = document.getElementById('pm-agent-chat-history');
    if (!history) return;

    const container = document.createElement('div');
    container.className = 'pm-agent-receipt-card pending';
    container.style.borderColor = 'var(--pm-agent-yellow)';

    container.innerHTML = `
      <div class="pm-agent-receipt-title" style="color: var(--pm-agent-yellow);">
        <svg viewBox="0 0 24 24" style="fill: var(--pm-agent-yellow); width: 18px; height: 18px; margin-right: 6px;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 11h-2V7h2v6zm0 4h-2v-2h2v2z"/>
        </svg>
        <span>Limit Order Placed (Pending)</span>
      </div>
      <div class="pm-agent-order-details">
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Shares:</span>
          <span class="pm-agent-order-value">${receipt.shares}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Limit Price:</span>
          <span class="pm-agent-order-value">$${parseFloat(receipt.avgPrice).toFixed(2)}</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Total Spent:</span>
          <span class="pm-agent-order-value">${receipt.totalSpent} USDC</span>
        </div>
        <div class="pm-agent-order-row">
          <span class="pm-agent-order-label">Status:</span>
          <span class="pm-agent-order-value" style="color: var(--pm-agent-yellow); font-weight: bold;">Waiting for Price Target</span>
        </div>
      </div>
    `;

    history.appendChild(container);
    scrollToBottom();
    logChatToStorage('order_pending', { receipt: receipt });
  }


  // --- In-Page Comments Analysis Functionality ---

  // Search DOM for the leaf header element containing Comments count
  function findCommentsHeader() {
    const elements = Array.from(document.querySelectorAll('div, span, button, p, h2, h3, a'));
    const matches = elements.filter(el => {
      const text = el.innerText ? el.innerText.trim() : '';
      return /^(评论|Comments)\s*[\(\（]\s*\d+(?:[.,]\d+)*\s*[kKmM]?\s*[\)\）]$/i.test(text);
    });
    
    if (matches.length > 0) {
      // Sort by number of descendant nodes to find the leaf-most matching element
      matches.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      return matches[0];
    }
    return null;
  }

  // Find container tab-bar and inject the analysis button and card
  function injectCommentsAnalysis() {
    const commentsTab = findCommentsHeader();
    if (!commentsTab) return;

    // Resolve the tab bar row (flex container of tabs)
    let tabBarContainer = commentsTab.parentElement;
    while (tabBarContainer && tabBarContainer !== document.body) {
      const text = tabBarContainer.innerText || '';
      const hasTopHolders = text.includes('顶级持仓者') || text.includes('Top Holders');
      const hasHolders = text.includes('持仓') || text.includes('Holders');
      if (hasTopHolders || hasHolders) {
        break;
      }
      tabBarContainer = tabBarContainer.parentElement;
    }
    
    if (!tabBarContainer) {
      tabBarContainer = commentsTab.parentElement;
    }

    // 1. Inject the "AI 舆情分析" button next to commentsTab if missing
    let btn = document.getElementById('pm-agent-in-page-analysis-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'pm-agent-in-page-btn';
      btn.id = 'pm-agent-in-page-analysis-btn';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/>
        </svg>
        <span>一键分析舆论</span>
      `;
      btn.addEventListener('click', handleInPageAnalysisClick);
      inPageBtnInstance = btn;
    }

    if (btn.parentNode !== commentsTab.parentNode) {
      commentsTab.parentNode.insertBefore(btn, commentsTab.nextSibling);
    }

    // 2. Keep the analysis card inserted if it was active but React detached it
    if (isAnalysisOpen && analysisCardInstance && !document.body.contains(analysisCardInstance)) {
      console.log("[Polymarket AI Agent] Analysis card detached by React. Re-inserting...");
      insertAnalysisCard(tabBarContainer);
    } else if (analysisCardInstance && document.body.contains(analysisCardInstance)) {
      // Ensure we keep the theme up to date dynamically when toggled on parent
      const isDark = checkIsDarkTheme();
      analysisCardInstance.classList.remove('theme-dark', 'theme-light');
      analysisCardInstance.classList.add(isDark ? 'theme-dark' : 'theme-light');
    }
  }

  // Send cancel message to background page
  function cancelActiveAnalysis(slug) {
    console.log("[Polymarket AI Agent] Sending CANCEL_ANALYZE_COMMENTS for:", slug);
    chrome.runtime.sendMessage({
      type: 'CANCEL_ANALYZE_COMMENTS',
      slug: slug
    });
  }

  // Handle in-page button click
  function handleInPageAnalysisClick() {
    const commentsTab = findCommentsHeader();
    if (!commentsTab) return;
    
    let tabBarContainer = commentsTab.parentElement;
    while (tabBarContainer && tabBarContainer !== document.body) {
      const text = tabBarContainer.innerText || '';
      const hasTopHolders = text.includes('顶级持仓者') || text.includes('Top Holders');
      if (hasTopHolders) break;
      tabBarContainer = tabBarContainer.parentElement;
    }
    if (!tabBarContainer) tabBarContainer = commentsTab.parentElement;

    // Toggle card display
    if (analysisCardInstance && document.body.contains(analysisCardInstance)) {
      analysisCardInstance.remove();
      isAnalysisOpen = false;
      const pathParts = window.location.pathname.split('/');
      const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
      if (slug) cancelActiveAnalysis(slug);
      return;
    }

    if (!analysisCardInstance) {
      analysisCardInstance = document.createElement('div');
      analysisCardInstance.className = 'pm-agent-page-analysis-card';
    }

    isAnalysisOpen = true;
    insertAnalysisCard(tabBarContainer);
    triggerInPageCommentsAnalysis();
  }

  // Insert analysis card DOM node below tab-bar
  function insertAnalysisCard(tabBarContainer) {
    if (!analysisCardInstance) return;

    const isDark = checkIsDarkTheme();
    analysisCardInstance.className = `pm-agent-page-analysis-card ${isDark ? 'theme-dark' : 'theme-light'}`;

    analysisCardInstance.innerHTML = `
      <div class="pm-agent-analysis-header">
        <div class="pm-agent-analysis-title-box">
          <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; fill: var(--pm-agent-primary);">
            <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/>
          </svg>
          <h3 class="pm-agent-analysis-title">AI 舆情与 Twitter 热点分析</h3>
        </div>
        <button class="pm-agent-analysis-close-btn" id="pm-agent-analysis-close-btn">
          <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:currentColor;">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="pm-agent-analysis-columns">
        <div class="pm-agent-analysis-col">
          <h4 class="pm-agent-analysis-col-title">💬 Polymarket 评论观点汇总</h4>
          <div class="pm-agent-analysis-report-text" id="pm-agent-analysis-comments-report">
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 20px 0; gap:8px;">
              <svg class="pm-agent-rotate" viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--pm-agent-primary);"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm-6 8c0-1.01.25-1.97.7-2.8L5.24 6.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v-3l4 4-4-4v3c-3.31 0-6-2.69-6-6z"/></svg>
              <span style="font-size:11px; color:var(--pm-agent-text-light-secondary);">正在拉取并分析评论区舆情...</span>
            </div>
          </div>
        </div>
        <div class="pm-agent-analysis-col">
          <h4 class="pm-agent-analysis-col-title">🐦 Twitter 舆情与热点话题</h4>
          <div class="pm-agent-twitter-topics-list" id="pm-agent-analysis-twitter-list">
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 20px 0; gap:8px;">
              <svg class="pm-agent-rotate" viewBox="0 0 24 24" style="width:18px;height:18px;fill:#1d9bf0;"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm-6 8c0-1.01.25-1.97.7-2.8L5.24 6.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v-3l4 4-4-4v3c-3.31 0-6-2.69-6-6z"/></svg>
              <span style="font-size:11px; color:var(--pm-agent-text-light-secondary);">正在拉取并分析 Twitter 热点...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Insert right below the tabBarContainer
    tabBarContainer.parentNode.insertBefore(analysisCardInstance, tabBarContainer.nextSibling);

    // Bind close button
    const closeBtn = analysisCardInstance.querySelector('#pm-agent-analysis-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        analysisCardInstance.remove();
        isAnalysisOpen = false;
        const pathParts = window.location.pathname.split('/');
        const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
        if (slug) cancelActiveAnalysis(slug);
      });
    }
  }

  // Trigger analysis and load content
  function triggerInPageCommentsAnalysis() {
    const commentsReport = document.getElementById('pm-agent-analysis-comments-report');
    const twitterList = document.getElementById('pm-agent-analysis-twitter-list');
    if (!commentsReport || !twitterList) return;

    // Extract event slug
    const pathParts = window.location.pathname.split('/');
    const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
    
    if (!slug) {
      commentsReport.innerHTML = '无法解析当前事件 Slug，请确认您在 Polymarket 事件页面上。';
      return;
    }

    chrome.runtime.sendMessage({
      type: 'ANALYZE_COMMENTS',
      slug: slug,
      marketTitle: marketTitle
    }, (response) => {
      // If the card is closed/removed, ignore the response
      if (!isAnalysisOpen || !analysisCardInstance || !document.body.contains(analysisCardInstance)) {
        console.log("[Polymarket AI Agent] Card closed, ignoring analysis response.");
        return;
      }

      const currentCommentsReport = document.getElementById('pm-agent-analysis-comments-report');
      const currentTwitterList = document.getElementById('pm-agent-analysis-twitter-list');
      if (!currentCommentsReport || !currentTwitterList) return;

      if (response && response.aborted) {
        console.log("[Polymarket AI Agent] Analysis request was aborted.");
        return;
      }

      if (chrome.runtime.lastError || !response || response.error) {
        currentCommentsReport.innerHTML = `
          <h4>分析失败</h4>
          <p>${response?.message || '可能原因：未配置 Gemini API 密钥以调用 AI 情绪分析功能。'}</p>
        `;
        currentTwitterList.innerHTML = '<div style="font-size:12px; color:var(--pm-agent-text-light-secondary); text-align:center; padding: 20px;">拉取 Twitter 热点失败。</div>';
        return;
      }

      // Render Comments Analysis Markdown
      let html = response.analysis || '';
      html = html.replace(/\n\n/g, '<p></p>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/^\* (.*)/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1<\/ul>');
      
      currentCommentsReport.innerHTML = `
        <div style="font-size:13px; line-height:1.55; color: inherit;">
          ${html}
        </div>
      `;

      // Render Twitter Signals/Error
      if (response.twitterError) {
        currentTwitterList.innerHTML = `<div style="font-size:12px; color:var(--pm-agent-text-light-secondary); text-align:center; padding: 20px;">无法获取 Twitter 舆情：${response.twitterError}</div>`;
        return;
      }

      const tweets = response.twitterSignals || [];
      if (tweets.length === 0) {
        currentTwitterList.innerHTML = '<div style="font-size:12.5px; color:var(--pm-agent-text-light-secondary); text-align:center; padding: 20px;">未监测到相关 Twitter 热点。</div>';
        return;
      }

      currentTwitterList.innerHTML = '';
      tweets.forEach(tweet => {
        const card = document.createElement('div');
        card.className = 'pm-agent-twitter-topic-card';
        
        const impactClass = tweet.impact ? tweet.impact.toLowerCase() : 'neutral';
        
        card.innerHTML = `
          <div class="pm-agent-twitter-card-header">
            <span>${tweet.author}</span>
            <span class="pm-agent-signal-impact ${impactClass}">${tweet.impact}</span>
          </div>
          <div class="pm-agent-signal-content" style="margin-top: 4px; font-size:11.5px; color: inherit; line-height:1.4;">${tweet.content}</div>
          <div class="pm-agent-signal-time" style="font-size:9.5px; text-align:right; margin-top:4px; color:var(--pm-agent-text-light-secondary);">${tweet.time}</div>
        `;
        currentTwitterList.appendChild(card);
      });
    });
  }

  function checkIsDarkTheme() {
    return isDarkMode();
  }

  // Start initialization
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
