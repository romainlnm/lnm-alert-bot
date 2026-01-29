import { Composer } from 'grammy'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { priceFeed } from '../../services/price-feed.js'
import type { AuthContext } from '../middleware/auth.js'

export const publicCommands = new Composer<AuthContext>()

// /start - Welcome message
publicCommands.command('start', async (ctx) => {
  const ticker = priceFeed.ticker
  const priceInfo = ticker ? `\n\n📊 Current BTC price: $${ticker.lastPrice.toLocaleString()}` : ''

  await ctx.reply(
    `👋 Welcome to <b>LN Markets Alert Bot</b>!\n` +
      `${priceInfo}\n\n` +
      `<b>Public Commands (no login required):</b>\n` +
      `/price &lt;amount&gt; - Alert when BTC hits price\n` +
      `/funding &lt;rate&gt; - Alert on funding rate\n` +
      `/ticker - Current price & funding\n` +
      `/alerts - View your alerts\n\n` +
      `<b>Private Commands (requires API key):</b>\n` +
      `/connect - Link your LN Markets account\n` +
      `/status - View your positions\n` +
      `/margin &lt;%&gt; - Alert on low margin\n` +
      `/liquidation &lt;%&gt; - Alert when liquidation is near\n\n` +
      `Get your API key at https://lnmarkets.com/user/api`,
    { parse_mode: 'HTML' }
  )
})

// /ticker - Show current price and funding
publicCommands.command('ticker', async (ctx) => {
  const ticker = priceFeed.ticker
  const funding = priceFeed.funding

  if (!ticker) {
    return ctx.reply('⏳ Price feed not available yet. Try again in a moment.')
  }

  const fundingPercent = funding ? (funding.rate * 100).toFixed(4) : 'N/A'
  const nextFunding = funding
    ? funding.nextFundingTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : 'N/A'

  await ctx.reply(
    `📊 <b>BTC/USD Ticker</b>\n\n` +
      `Price: <b>$${ticker.lastPrice.toLocaleString()}</b>\n` +
      `24h High: $${ticker.high24h.toLocaleString()}\n` +
      `24h Low: $${ticker.low24h.toLocaleString()}\n` +
      `Bid: $${ticker.bid.toLocaleString()}\n` +
      `Ask: $${ticker.ask.toLocaleString()}\n\n` +
      `💰 <b>Funding</b>\n` +
      `Rate: ${fundingPercent}%\n` +
      `Next: ${nextFunding}`,
    { parse_mode: 'HTML' }
  )
})

// /price <amount> - Set price alert
publicCommands.command('price', async (ctx) => {
  const args = ctx.message?.text?.split(' ').slice(1) || []

  if (args.length === 0) {
    return ctx.reply(
      '📈 <b>Price Alerts</b>\n\n' +
        'Set an alert when BTC reaches a specific price.\n\n' +
        '<b>Usage:</b>\n' +
        '/price 100000 - Alert when price hits $100,000\n' +
        '/price 90000 below - Alert when price drops to $90,000\n\n' +
        'Alerts fire once by default. Add "repeat" for recurring alerts.',
      { parse_mode: 'HTML' }
    )
  }

  const targetPrice = parseFloat(args[0].replace(/,/g, ''))
  if (isNaN(targetPrice) || targetPrice <= 0) {
    return ctx.reply('❌ Invalid price. Please enter a number like: /price 100000')
  }

  const currentPrice = priceFeed.currentPrice || 0
  const direction = args.includes('below') ? 'below' :
                    targetPrice < currentPrice ? 'below' : 'above'
  const repeating = args.includes('repeat')
  const alertType = direction === 'above' ? 'price_above' : 'price_below'

  // Save alert
  await db.insert(schema.alerts).values({
    telegramId: ctx.from!.id,
    type: alertType,
    targetValue: targetPrice,
    repeating,
  })

  const emoji = direction === 'above' ? '📈' : '📉'
  await ctx.reply(
    `${emoji} <b>Price alert set!</b>\n\n` +
      `You'll be notified when BTC goes ${direction} <b>$${targetPrice.toLocaleString()}</b>\n` +
      `Current price: $${currentPrice.toLocaleString()}\n\n` +
      `${repeating ? '🔁 This alert will repeat.' : '☝️ This alert will fire once.'}`,
    { parse_mode: 'HTML' }
  )
})

// /funding <rate> - Set funding rate alert
publicCommands.command('funding', async (ctx) => {
  const args = ctx.message?.text?.split(' ').slice(1) || []

  if (args.length === 0) {
    const currentRate = priceFeed.currentFundingRate
    const rateStr = currentRate !== undefined ? (currentRate * 100).toFixed(4) : 'N/A'

    return ctx.reply(
      '💰 <b>Funding Rate Alerts</b>\n\n' +
        `Current rate: ${rateStr}%\n\n` +
        '<b>Usage:</b>\n' +
        '/funding 0.05 - Alert when rate exceeds 0.05%\n' +
        '/funding -0.02 below - Alert when rate drops below -0.02%',
      { parse_mode: 'HTML' }
    )
  }

  const targetRate = parseFloat(args[0])
  if (isNaN(targetRate)) {
    return ctx.reply('❌ Invalid rate. Please enter a number like: /funding 0.05')
  }

  const direction = args.includes('below') ? 'below' : 'above'
  const alertType = direction === 'above' ? 'funding_above' : 'funding_below'
  const repeating = args.includes('repeat')

  await db.insert(schema.alerts).values({
    telegramId: ctx.from!.id,
    type: alertType,
    targetValue: targetRate,
    repeating,
  })

  await ctx.reply(
    `💰 <b>Funding alert set!</b>\n\n` +
      `You'll be notified when funding rate goes ${direction} <b>${targetRate}%</b>`,
    { parse_mode: 'HTML' }
  )
})

// /alerts - List user's alerts
publicCommands.command('alerts', async (ctx) => {
  const userAlerts = await db
    .select()
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.telegramId, ctx.from!.id),
        eq(schema.alerts.active, true)
      )
    )

  if (userAlerts.length === 0) {
    return ctx.reply(
      '📭 You have no active alerts.\n\n' +
        'Use /price or /funding to create one!'
    )
  }

  const alertLines = userAlerts.map((a, i) => {
    const emoji = a.type.includes('price') ? '📈' :
                  a.type.includes('funding') ? '💰' :
                  a.type.includes('margin') ? '⚠️' : '🚨'
    const typeLabel = a.type.replace(/_/g, ' ')
    const repeat = a.repeating ? ' 🔁' : ''
    return `${i + 1}. ${emoji} ${typeLabel}: ${a.targetValue}${repeat}`
  })

  await ctx.reply(
    `🔔 <b>Your Active Alerts</b>\n\n` +
      alertLines.join('\n') +
      `\n\nUse /cancel &lt;number&gt; to remove an alert.`,
    { parse_mode: 'HTML' }
  )
})

// /cancel <number> - Cancel an alert
publicCommands.command('cancel', async (ctx) => {
  const args = ctx.message?.text?.split(' ').slice(1) || []

  if (args.length === 0 || args[0] === 'all') {
    // Cancel all alerts
    const result = await db
      .update(schema.alerts)
      .set({ active: false })
      .where(
        and(
          eq(schema.alerts.telegramId, ctx.from!.id),
          eq(schema.alerts.active, true)
        )
      )

    return ctx.reply('✅ All alerts cancelled.')
  }

  const alertIndex = parseInt(args[0]) - 1
  if (isNaN(alertIndex) || alertIndex < 0) {
    return ctx.reply('❌ Invalid alert number. Use /alerts to see your alerts.')
  }

  // Get user's alerts to find the one to cancel
  const userAlerts = await db
    .select()
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.telegramId, ctx.from!.id),
        eq(schema.alerts.active, true)
      )
    )

  if (alertIndex >= userAlerts.length) {
    return ctx.reply('❌ Alert not found. Use /alerts to see your alerts.')
  }

  await db
    .update(schema.alerts)
    .set({ active: false })
    .where(eq(schema.alerts.id, userAlerts[alertIndex].id))

  await ctx.reply('✅ Alert cancelled.')
})
