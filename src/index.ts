import { createBot } from './bot/index.js'
import { priceFeed } from './services/price-feed.js'
import { AlertEngine } from './services/alerts.js'

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN required')
    process.exit(1)
  }

  console.log('Starting LN Markets Alert Bot...')

  // Start price feed
  priceFeed.start()

  // Wait for first price
  await new Promise<void>((resolve) => {
    const check = () => priceFeed.currentPrice ? resolve() : setTimeout(check, 100)
    check()
  })
  console.log(`Price feed ready: $${priceFeed.currentPrice.toLocaleString()}`)

  // Create and start bot
  const bot = createBot(token)
  const alertEngine = new AlertEngine(bot)
  alertEngine.start()

  await bot.start({
    onStart: (info) => console.log(`Bot started: @${info.username}`),
  })

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...')
    priceFeed.stop()
    alertEngine.stop()
    bot.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(console.error)
