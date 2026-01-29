# LN Markets Alert Bot

Telegram bot for LN Markets price and position alerts.

## Features

### Public (no account required)
- `/price <amount>` - Alert when BTC hits a price
- `/funding <rate>` - Alert on funding rate changes
- `/ticker` - Current price and funding info
- `/alerts` - View your active alerts
- `/cancel <number>` - Cancel an alert

### Private (requires API key)
- `/connect` - Link your LN Markets account
- `/status` - View your positions and balance
- `/margin <percent>` - Alert when margin drops below threshold
- `/liquidation <percent>` - Alert when liquidation is near
- `/disconnect` - Remove your API credentials

## Setup

1. **Create a Telegram bot**
   - Talk to [@BotFather](https://t.me/BotFather)
   - Create a new bot with `/newbot`
   - Copy the token

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your bot token
   ```

3. **Install and run**
   ```bash
   pnpm install
   pnpm dev
   ```

## Deployment

### Using Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
CMD ["node", "dist/index.js"]
```

### Using systemd

```ini
[Unit]
Description=LN Markets Alert Bot
After=network.target

[Service]
Type=simple
User=bot
WorkingDirectory=/opt/lnm-alert-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
EnvironmentFile=/opt/lnm-alert-bot/.env

[Install]
WantedBy=multi-user.target
```

## Security Notes

- API credentials are stored in SQLite (consider encryption for production)
- Users should create **read-only** API keys
- The bot deletes messages containing credentials when possible
- Never share your bot token

## License

MIT
