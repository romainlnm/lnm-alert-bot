# LN Markets Alert Bot

Telegram bot for BTC price alerts on LN Markets.

## Features

- **Smart alerts** - "Alert me if BTC drops 5% in 1 hour"
- **Price alerts** - "Alert me when BTC hits $100k"
- **Button-based UI** - No commands to remember

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Deploy to Fly.io:
   ```bash
   fly launch
   fly secrets set TELEGRAM_BOT_TOKEN=your_token
   fly deploy
   ```

## License

MIT
