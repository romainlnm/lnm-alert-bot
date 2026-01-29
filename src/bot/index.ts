import { Bot, InlineKeyboard, Context } from 'grammy'
import { getOrCreateUser, createAlert, getUserAlerts, deactivateAlert } from '../db/index.js'
import { priceFeed } from '../services/price-feed.js'

const CB = {
  MENU: 'menu',
  NEW_ALERT: 'new',
  MY_ALERTS: 'alerts',
  CONNECT: 'connect',
} as const

export function createBot(token: string): Bot {
  const bot = new Bot(token)

  // Ensure user exists
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      getOrCreateUser(ctx.from.id, ctx.from.username)
    }
    return next()
  })

  // /start
  bot.command('start', showMainMenu)
  bot.callbackQuery(CB.MENU, showMainMenu)

  // New Alert
  bot.callbackQuery(CB.NEW_ALERT, showAlertTypes)
  bot.callbackQuery(/^type:percent$/, showPercentOptions)
  bot.callbackQuery(/^pct:(-?\d+)$/, showTimeOptions)
  bot.callbackQuery(/^time:(\d+):(-?\d+)$/, createPercentAlert)
  bot.callbackQuery(/^type:price_(above|below)$/, askForPrice)

  // Price input
  bot.on('message:text', handlePriceInput)

  // My alerts
  bot.callbackQuery(CB.MY_ALERTS, showMyAlerts)
  bot.callbackQuery(/^del:(\d+)$/, deleteAlert)

  // Connect
  bot.callbackQuery(CB.CONNECT, showConnectInfo)

  bot.catch((err) => console.error('Bot error:', err))

  return bot
}

async function showMainMenu(ctx: Context) {
  const price = priceFeed.currentPrice
  const priceStr = price ? `$${price.toLocaleString()}` : 'Loading...'

  const change1h = priceFeed.getPercentChange(60)
  const change24h = priceFeed.getPercentChange(24 * 60)

  let changeStr = ''
  if (change1h !== null) {
    const h1 = `${change1h >= 0 ? '+' : ''}${change1h.toFixed(2)}%`
    const h24 = change24h !== null ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%` : 'N/A'
    changeStr = `\n📊 1h: ${h1}  24h: ${h24}`
  }

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
    '🔔 <b>Choose Alert Type</b>\n\n<b>Smart:</b> Alert on % change\n<b>Simple:</b> Alert at specific price',
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

  await ctx.editMessageText('📊 <b>Alert on % Change</b>\n\nHow much should price move?', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
  await ctx.answerCallbackQuery()
}

async function showTimeOptions(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^pct:(-?\d+)$/)
  if (!match) return
  const percent = match[1]

  const keyboard = new InlineKeyboard()
    .text('15 min', `time:15:${percent}`)
    .text('1 hour', `time:60:${percent}`)
    .text('4 hours', `time:240:${percent}`)
    .row()
    .text('12 hours', `time:720:${percent}`)
    .text('24 hours', `time:1440:${percent}`)
    .row()
    .text('« Back', 'type:percent')

  await ctx.editMessageText(`⏱ <b>Time Window</b>\n\nAlert when price moves <b>${percent}%</b> within:`, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
  await ctx.answerCallbackQuery()
}

async function createPercentAlert(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^time:(\d+):(-?\d+)$/)
  if (!match || !ctx.from) return

  const minutes = parseInt(match[1])
  const percent = parseInt(match[2])

  createAlert(ctx.from.id, 'percent_change', percent, minutes)

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

const pendingPriceAlerts = new Map<number, 'price_above' | 'price_below'>()

async function askForPrice(ctx: Context) {
  const match = ctx.callbackQuery?.data?.match(/^type:price_(above|below)$/)
  if (!match || !ctx.from) return

  pendingPriceAlerts.set(ctx.from.id, `price_${match[1]}` as 'price_above' | 'price_below')

  await ctx.editMessageText(
    `💰 <b>Set Price Alert</b>\n\nCurrent: $${priceFeed.currentPrice.toLocaleString()}\n\nType the price:`,
    { parse_mode: 'HTML' }
  )
  await ctx.answerCallbackQuery()
}

async function handlePriceInput(ctx: Context) {
  if (!ctx.from || !ctx.message?.text) return

  const alertType = pendingPriceAlerts.get(ctx.from.id)
  if (!alertType) return

  const price = parseFloat(ctx.message.text.replace(/[$,]/g, ''))
  if (isNaN(price) || price <= 0) {
    await ctx.reply('❌ Please enter a valid price.')
    return
  }

  pendingPriceAlerts.delete(ctx.from.id)
  createAlert(ctx.from.id, alertType, price)

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

  const alerts = getUserAlerts(ctx.from.id)

  if (alerts.length === 0) {
    const keyboard = new InlineKeyboard().text('🔔 Create Alert', CB.NEW_ALERT).row().text('« Menu', CB.MENU)
    const text = "📭 <b>No Active Alerts</b>\n\nYou don't have any alerts yet."

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

  for (const alert of alerts) {
    let desc = ''
    if (alert.type === 'percent_change') {
      const t = (alert.time_window_minutes ?? 60) >= 60 ? `${(alert.time_window_minutes ?? 60) / 60}h` : `${alert.time_window_minutes}min`
      desc = `${alert.target_value < 0 ? '📉' : '📈'} ${alert.target_value > 0 ? '+' : ''}${alert.target_value}% in ${t}`
    } else if (alert.type === 'price_above') {
      desc = `📈 Above $${alert.target_value.toLocaleString()}`
    } else if (alert.type === 'price_below') {
      desc = `📉 Below $${alert.target_value.toLocaleString()}`
    }
    text += `• ${desc}\n`
    keyboard.text(`🗑 Delete`, `del:${alert.id}`).row()
  }

  keyboard.text('🔔 Add Alert', CB.NEW_ALERT).row().text('« Menu', CB.MENU)

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

  deactivateAlert(parseInt(match[1]), ctx.from.id)
  await ctx.answerCallbackQuery('Alert deleted!')
  await showMyAlerts(ctx)
}

async function showConnectInfo(ctx: Context) {
  const keyboard = new InlineKeyboard().url('Get API Key', 'https://lnmarkets.com/user/api').row().text('« Menu', CB.MENU)

  await ctx.editMessageText(
    '🔐 <b>Connect Your Account</b>\n\n' +
      'Link your LN Markets account to get:\n• ⚠️ Margin alerts\n• 🚨 Liquidation warnings\n\n<b>Coming soon!</b>',
    { parse_mode: 'HTML', reply_markup: keyboard }
  )
  await ctx.answerCallbackQuery()
}
