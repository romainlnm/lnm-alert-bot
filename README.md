# LN Markets Alert Bot

Telegram bot for LN Markets price alerts with smart notifications.

## Features

### Smart Alerts
- **Percent change alerts** - "Alert me if BTC drops 5% in 1 hour"
- Configurable time windows: 15min, 1h, 4h, 12h, 24h
- Works for both pumps (+5%) and dumps (-5%)

### Simple Alerts
- Price above $X
- Price below $X

### Easy Interface
- No commands to remember
- Button-based navigation
- One tap to create alerts

## Screenshots

```
┌─────────────────────────────┐
│ ⚡ LN Markets Alerts        │
│                             │
│ 💰 BTC: $97,432             │
│ 📊 1h: +0.5%  24h: -2.1%    │
│                             │
│ ┌───────────┬────────────┐  │
│ │ 🔔 New    │ 📋 My      │  │
│ │   Alert   │   Alerts   │  │
│ └───────────┴────────────┘  │
│ ┌────────────────────────┐  │
│ │ 🔐 Connect Account     │  │
│ └────────────────────────┘  │
└─────────────────────────────┘
```

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)

2. Configure:
   ```bash
   cp .env.example .env
   # Add your TELEGRAM_BOT_TOKEN
   ```

3. Run:
   ```bash
   pnpm install
   pnpm dev
   ```

## Deployment

### Docker

```bash
docker build -t lnm-alert-bot .
docker run -e TELEGRAM_BOT_TOKEN=xxx lnm-alert-bot
```

### Fly.io

```bash
fly launch
fly secrets set TELEGRAM_BOT_TOKEN=xxx
fly deploy
```

## Coming Soon

- 🔐 Account connection for margin/liquidation alerts
- 📊 Position tracking
- 💰 P&L notifications

## License

MIT
