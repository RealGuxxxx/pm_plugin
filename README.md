# Polymarket AI Agent Trader 🚀

A premium Manifest V3 Chrome Extension that integrates a conversational AI trading assistant and real-time public opinion sentiment analysis directly into the Polymarket interface.

---

## 🌟 Key Features

### 1. Conversational AI Trading Assistant
- **In-Page Chat Sidebar**: Interact with an AI agent directly on any Polymarket event page.
- **Market & Limit Orders**: Place simulated or live orders (BUY/SELL) by simply typing instructions (e.g., *"Limit buy YES for 10 USDC at $0.40"*).
- **Multi-Backend AI Routing**: Toggle between **Google Gemini**, **Tencent Hunyuan**, or a **Local Goose Daemon** to parse trading intents.
- **Zero-Latency Price Context**: Scrapes outcome odds directly from the active page DOM and injects them as prompt context so the AI always makes informed decisions.

### 2. Premium Portfolio & Options Dashboard
- **Real-Time Holdings tracking**: View simulated positions, wallet balance, and real-time profit and loss metrics.
- **Consistent Price Alignment**: All prices are formatted cleanly in dollars (e.g. `$0.50 → $0.49`) and fetched securely via background service workers to bypass CORS restrictions.
- **Sleek Custom Modals**: Redeem (sell back) positions with a beautiful, state-of-the-art glassmorphism confirmation modal overlay instead of ugly browser native dialogs.
- **Interactive Chat History**: Review past dialogue sessions, complete with detailed order receipts and execution receipts.

### 3. Background Limit Order Monitor
- **Locked Escrow Funds**: Placing a pending limit order automatically reserves your funds to prevent double-spending.
- **Continuous Monitoring**: Spawns a background check loop every 8 seconds (backed by a 1-minute alarm wake-up routine) to watch target price targets.
- **Auto-Execution**: Automatically fills your limit order when the target price is touched and triggers a native Chrome desktop notification.

### 4. Real-time Opinion & Twitter Signals
- **One-Click Public Sentiment**: Click the analysis button on event pages to load and summarize Polymarket comments and Twitter/X keyword search streams.
- **Real Twitter Identity**: Fetches real usernames and avatars instead of masked placeholders.
- **Batch Chinese Translation**: English Twitter feeds are batched and translated to Chinese via the local daemon in a single AI pass.
- **BPE Token Decoder**: Built-in decoders sanitize raw BPE symbols and latin1 characters into clean, garble-free UTF-8 text.

---

## 📂 Project Structure

```bash
├── manifest.json       # Manifest V3 configuration
├── background.js       # Background service worker (monitors limit orders, fetches prices, routes messages)
├── content.js          # Injected content script (scrapes page DOM, handles inlined chat sidebar UI)
├── content.css         # Styling for the inlined chat console and opinion analysis cards
├── options.html        # Premium dashboard HTML layout (Settings, Portfolio, Chat History)
├── options.js          # Dashboard controller logic (custom modals, live price polling, settings sync)
├── popup.html/js       # Extension toolbar popup interface redirecting to dashboard
├── xapi_daemon.js      # Local bridge server (interacts with xapi CLI and runs model translators)
└── .gitignore          # Git exclusion rules
```

---

## 🚀 Quick Start

### 1. Load the Chrome Extension
1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked** (top-left corner) and select this `pm_plugin` directory.

### 2. Spin Up the Local Bridge Daemon
Ensure you have Node.js installed, then start the bridge daemon:
```bash
node xapi_daemon.js
```
*Note: The daemon will run by default on `http://localhost:3000` and communicate with the `xapi` CLI tool.*

### 3. Configure Settings
1. Open the extension's **Options Page** (click the extension icon or navigate to dashboard).
2. Save your API credentials (Gemini Key, Hunyuan Key, Polygon Address, etc.) in the **系统配置 (Settings)** tab.
3. Verify the Daemon Status badge shows **Online**.

### 4. Start Trading!
1. Visit any event on [Polymarket](https://polymarket.com/).
2. Use the in-page chat sidebar to analyze sentiments or execute orders.
