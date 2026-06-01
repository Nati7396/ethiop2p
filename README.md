# EthioP2P - Crypto Ad Center

A Telegram P2P crypto trading bot for Ethiopia. Invite-only marketplace where users post buy/sell ads for crypto and trade directly using ETB (Ethiopian Birr).

## Features

- **Whitelist-only** access — admin controls who can join
- **Ad System** — post buy/sell ads for USDT, BTC, ETH
- **Trade Flow** — structured escrow-style confirmation flow
- **Feedback System** — reputation scoring after each trade
- **Trade Limits** — reputation-based limits (5k / 20k / 50k ETB)
- **Payment Methods** — Bank, Telebirr, M-Pesa
- **Trade Chat** — in-bot messaging between trade partners
- **Admin Panel** — full control via `/admin` command
- **Stats** — global trading statistics

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/yourusername/ethiop2p.git
   cd ethiop2p
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file:
   ```bash
   cp .env.example .env
   ```
   Fill in your `BOT_TOKEN` and `ADMIN_TELEGRAM_ID`.

4. Run the bot:
   ```bash
   npm start
   ```

## Deploy on Railway

1. Push to GitHub
2. Connect repo to Railway
3. Set env vars: `BOT_TOKEN`, `ADMIN_TELEGRAM_ID`
4. Deploy — Railway auto-detects Node.js

## Commands

| Command | Description |
|---|---|
| `/start` | Welcome + main menu |
| `/post` | Create a new ad |
| `/ads` | Browse active ads |
| `/myads` | Manage your ads |
| `/profile` | View your profile |
| `/payment` | Set payment details |
| `/tradechat <id>` | Chat with trade partner |
| `/stats` | Global trading stats |
| `/admin` | Admin panel (admin only) |

## Trade Limits by Reputation

| Level | Trades | Positive % | Max ETB |
|---|---|---|---|
| New | 0–2 | any | 5,000 |
| Verified | 3–10 | 80%+ | 20,000 |
| Trusted | 11+ | 90%+ | 50,000 |

## Payment Methods
- Bank (Ethiopian private banks)
- Telebirr
- M-Pesa

All prices in Ethiopian Birr (ETB).
