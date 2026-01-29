import { Bot, InlineKeyboard, Context } from 'grammy'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { priceFeed } from '../services/price-feed.js'

// Callback data prefixes
const CB = {
  MENU: 'menu',
  NEW_ALERT: 'new',
  ALERT_TYPE: 'type',
  PERCENT: 'pct',
  TIME: 'time',
  PRICE: 'price',
  MY_ALERTS: 'alerts',
  DELETE: 'del',
  CONNECT: 'connect',
} as const

export function createBot(token: string): Bot {
  const bot = new Bot(token)

  // Ensure user exists
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await db
        .insert(schema.users)
        .values({ telegramId: ctx.from.id, username: ctx.from.username })
        .onConflictDoNothing()
    }
    return next()
  })

  // /start - Main menu
  bot.command('start', showMainMenu)
  bot.callbackQuery(CB.MENU, showMainMenu)

  // New Alert flow
  bot.callbackQuery(CB.NEW_ALERT, showAlertTypes)

  // Smart alert: percent change
  bot.callbackQuery(/^type:percent$/, showPercentOptions)
  bot.callbackQuery(/^pct:(-?\d+)$/, showTimeOptions)
  bot.callbackQuery(/^time:(\d+):(-?\d+)$/, createPercentAlert)

  // Simple alert: price above/below
  bot.callbackQuery(/^type:price_(above|below)$/, askForPrice)

  // Handle price input for simple alerts
  bot.on('message:text', handlePriceInput)

  // My alerts
  bot.callbackQuery(CB.MY_ALERTS, showMyAlerts)
  bot.callbackQuery(/^del:(\d+)$/, deleteAlert)

  // Connect account
  bot.callbackQuery(CB.CONNECT, showConnectInfo)

  bot.catch((err) => console.error('Bot error:', err))

  return bot
}

// ============ Handlers ============

async function showMainMenu(ctx: Context) {
  const price = priceFeed.currentPrice
  const priceStr = price ? `$${price.toLocaleString()}` : 'Loading...'

  const change1h = priceFeed.getPercentChange(60)
  const change24h = priceFeed.getPercentChange(24 * 60)

  const changeStr = change1h !== null
    ? `\n📊 1h: ${change1h >= 0 ? '+' : ''}${change1h.toFixed(2)}%  24h: ${change24h !== null ? (change24h >= 0 ? '+' : '') + change24h.toFixed(2) + '%' : 'N/A'}`
    : ''

  const keyboard = new InlineKeyboard()
    .text('🔔 New Alert', CB.NEW_ALERT)
    .text('📋 My Alerts', CB.MY_ALERTS)
    .row()
    .text('🔐 Connect Account', CB.CONNECT)

  const text = `⚡ <b>LN Markets Alerts</b>\n\n💰 BTC: <b>${priceStr}</b>${changeStr}\n\nWhat would you like to do?`

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
    await ctx.answerCallbackQuery()
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard })
  }
}

async function showAlertTypes(ctx: Context) {
  const keyboard = new InlineKeyboard()
    .text('📉 Price drops X%', 'type:percent')
    .row()
    .text('📈 Price above $X', 'type:price_above')
    .text('📉 Price below $X', 'type:price_below')
    .row()
    .text('« Back', CB.MENU)

  await ctx.editMessageText(
    '🔔 <b>Choose Alert Type</b>\n\n' +
    '<b>Smart Alert:</b> Alert on % change\n' +
    '<b>Simple Alert:</b> Alert at specific price',
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
  await ctx.answerCallbackQuery()
}

async function showPercentOptions(ctx: Context) {
  const keyboard = new InlineKeyboard()
    .text('📉 -3%', 'pct:-3').text('📉 -5%', 'pct:-5').text('📉 -10%', 'pct:-10')
    .row()
    .text('📈 +3%', 'pct:3').text('📈 +5%', 'pct:5').text('📈 +10%', 'pct:10')
    .row()
    .text('« Back', CB.NEW_ALERT)

  await ctx.editMessageText(
    '📊 <b>Alert on % Change</b>\n\nHow much should price move?',
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
  await ctx.answerCallbackQuery()
}

async function showTimeOptions(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^pct:(-?\d+)$/)
  if (!match) return
  const percent = match[1]
  const direction = parseInt(percent) < 0 ? 'drops' : 'rises'

  const keyboard = new InlineKeyboard()
    .text('15 min', `time:15:${percent}`)
    .text('1 hour', `time:60:${percent}`)
    .text('4 hours', `time:240:${percent}`)
    .row()
    .text('12 hours', `time:720:${percent}`)
    .text('24 hours', `time:1440:${percent}`)
    .row()
    .text('« Back', 'type:percent')

  await ctx.editMessageText(
    `⏱ <b>Time Window</b>\n\nAlert when price ${direction} <b>${percent}%</b> within:`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
  await ctx.answerCallbackQuery()
}

async function createPercentAlert(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^time:(\d+):(-?\d+)$/)
  if (!match || !ctx.from) return

  const minutes = parseInt(match[1])
  const percent = parseInt(match[2])

  await db.insert(schema.alerts).values({
    telegramId: ctx.from.id,
    type: 'percent_change',
    targetValue: percent,
    timeWindowMinutes: minutes,
  })

  const timeStr = minutes >= 60 ? `${minutes / 60}h` : `${minutes}min`
  const direction = percent < 0 ? '📉 drops' : '📈 rises'

  const keyboard = new InlineKeyboard()
    .text('🔔 Add Another', CB.NEW_ALERT)
    .text('📋 My Alerts', CB.MY_ALERTS)
    .row()
    .text('« Menu', CB.MENU)

  await ctx.editMessageText(
    `✅ <b>Alert Created!</b>\n\nYou'll be notified when BTC ${direction} <b>${Math.abs(percent)}%</b> within <b>${timeStr}</b>`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
  await ctx.answerCallbackQuery()
}

// Store pending price alert state
const pendingPriceAlerts = new Map<number, 'price_above' | 'price_below'>()

async function askForPrice(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^type:price_(above|below)$/)
  if (!match || !ctx.from) return

  const type = `price_${match[1]}` as 'price_above' | 'price_below'
  pendingPriceAlerts.set(ctx.from.id, type)

  const direction = match[1] === 'above' ? 'rises above' : 'drops below'
  const currentPrice = priceFeed.currentPrice

  await ctx.editMessageText(
    `💰 <b>Set Price Alert</b>\n\n` +
    `Current: $${currentPrice.toLocaleString()}\n\n` +
    `Enter the price you want to be alerted when BTC ${direction}:\n\n` +
    `<i>Just type a number like: 100000</i>`,
    { parse_mode: 'HTML' }
  )
  await ctx.answerCallbackQuery()
}

async function handlePriceInput(ctx: Context) {
  if (!ctx.from || !ctx.message?.text) return

  const alertType = pendingPriceAlerts.get(ctx.from.id)
  if (!alertType) return // Not waiting for price input

  const priceText = ctx.message.text.replace(/[$,]/g, '')
  const price = parseFloat(priceText)

  if (isNaN(price) || price <= 0) {
    await ctx.reply('❌ Please enter a valid price number.')
    return
  }

  pendingPriceAlerts.delete(ctx.from.id)

  await db.insert(schema.alerts).values({
    telegramId: ctx.from.id,
    type: alertType,
    targetValue: price,
  })

  const direction = alertType === 'price_above' ? '📈 rises above' : '📉 drops below'

  const keyboard = new InlineKeyboard()
    .text('🔔 Add Another', CB.NEW_ALERT)
    .text('📋 My Alerts', CB.MY_ALERTS)
    .row()
    .text('« Menu', CB.MENU)

  await ctx.reply(
    `✅ <b>Alert Created!</b>\n\nYou'll be notified when BTC ${direction} <b>$${price.toLocaleString()}</b>`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
}

async function showMyAlerts(ctx: Context) {
  if (!ctx.from) return

  const userAlerts = await db
    .select()
    .from(schema.alerts)
    .where(and(
      eq(schema.alerts.telegramId, ctx.from.id),
      eq(schema.alerts.active, true)
    ))

  if (userAlerts.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('🔔 Create Alert', CB.NEW_ALERT)
      .row()
      .text('« Menu', CB.MENU)

    const text = '📭 <b>No Active Alerts</b>\n\nYou don\'t have any alerts yet.'

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      await ctx.answerCallbackQuery()
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard })
    }
    return
  }

  const keyboard = new InlineKeyboard()

  let text = '📋 <b>Your Alerts</b>\n\n'

  for (const alert of userAlerts) {
    let desc = ''
    if (alert.type === 'percent_change') {
      const timeStr = (alert.timeWindowMinutes ?? 60) >= 60
        ? `${(alert.timeWindowMinutes ?? 60) / 60}h`
        : `${alert.timeWindowMinutes}min`
      const dir = alert.targetValue < 0 ? '📉' : '📈'
      desc = `${dir} ${alert.targetValue > 0 ? '+' : ''}${alert.targetValue}% in ${timeStr}`
    } else if (alert.type === 'price_above') {
      desc = `📈 Above $${alert.targetValue.toLocaleString()}`
    } else if (alert.type === 'price_below') {
      desc = `📉 Below $${alert.targetValue.toLocaleString()}`
    } else {
      desc = `${alert.type}: ${alert.targetValue}`
    }

    text += `• ${desc}\n`
    keyboard.text(`🗑 ${desc.slice(0, 20)}...`, `del:${alert.id}`).row()
  }

  keyboard.text('🔔 Add Alert', CB.NEW_ALERT).row()
  keyboard.text('« Menu', CB.MENU)

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
    await ctx.answerCallbackQuery()
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard })
  }
}

async function deleteAlert(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^del:(\d+)$/)
  if (!match || !ctx.from) return

  const alertId = parseInt(match[1])

  await db
    .update(schema.alerts)
    .set({ active: false })
    .where(and(
      eq(schema.alerts.id, alertId),
      eq(schema.alerts.telegramId, ctx.from.id)
    ))

  await ctx.answerCallbackQuery('Alert deleted!')
  await showMyAlerts(ctx)
}

async function showConnectInfo(ctx: Context) {
  const keyboard = new InlineKeyboard()
    .url('Get API Key', 'https://lnmarkets.com/user/api')
    .row()
    .text('« Menu', CB.MENU)

  await ctx.editMessageText(
    '🔐 <b>Connect Your Account</b>\n\n' +
    'Link your LN Markets account to get:\n' +
    '• ⚠️ Margin level alerts\n' +
    '• 🚨 Liquidation warnings\n' +
    '• 📊 Position updates\n\n' +
    '<b>Coming soon!</b>\n\n' +
    'For now, enjoy the free price alerts!',
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
  await ctx.answerCallbackQuery()
}
