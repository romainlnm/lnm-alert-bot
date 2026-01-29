import { createBot } from './bot/index.js'
import { priceFeed } from './services/price-feed.js'
import { AlertEngine } from './services/alerts.js'

// Load environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN is required')
  console.error('Set it in your environment or .env file')
  process.exit(1)
}

async function main() {
  console.log('🚀 Starting LN Markets Alert Bot...')

  // Initialize bot
  const bot = createBot(BOT_TOKEN)

  // Start price feed
  priceFeed.start()

  // Wait for initial price data
  await new Promise<void>((resolve) => {
    const checkPrice = () => {
      if (priceFeed.currentPrice) {
        resolve()
      } else {
        setTimeout(checkPrice, 100)
      }
    }
    checkPrice()
  })

  console.log(`📊 Price feed ready: $${priceFeed.currentPrice?.toLocaleString()}`)

  // Start alert engine
  const alertEngine = new AlertEngine(bot)
  alertEngine.start()

  // Start bot
  await bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Bot started: @${botInfo.username}`)
      console.log('')
      console.log('Ready to accept commands!')
      console.log('─'.repeat(40))
    },
  })

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down...')
    priceFeed.stop()
    alertEngine.stop()
    bot.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
