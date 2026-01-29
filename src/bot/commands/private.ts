import { Composer } from 'grammy'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { LNMarketsClient } from '../../services/lnmarkets.js'
import { priceFeed } from '../../services/price-feed.js'
import { requireAuth, type AuthContext } from '../middleware/auth.js'

export const privateCommands = new Composer<AuthContext>()

// /connect - Link LN Markets account
privateCommands.command('connect', async (ctx) => {
  const args = ctx.message?.text?.split(' ').slice(1) || []

  if (args.length < 3) {
    return ctx.reply(
      '🔐 <b>Connect Your LN Markets Account</b>\n\n' +
        'To use private features, you need to link your API credentials.\n\n' +
        '<b>Usage:</b>\n' +
        '<code>/connect API_KEY API_SECRET PASSPHRASE</code>\n\n' +
        '⚠️ <b>Security Notes:</b>\n' +
        '• Create a read-only API key for safety\n' +
        '• Delete this message after connecting\n' +
        '• Get your keys at: https://lnmarkets.com/user/api\n\n' +
        '🔒 Your credentials are stored encrypted and only used to check your positions.',
      { parse_mode: 'HTML' }
    )
  }

  const [apiKey, apiSecret, passphrase] = args

  // Verify credentials work
  try {
    const client = new LNMarketsClient({
      credentials: { apiKey, apiSecret, passphrase },
    })
    await client.getBalance()
  } catch (error) {
    return ctx.reply(
      '❌ <b>Connection failed</b>\n\n' +
        'Could not authenticate with LN Markets. Please check your credentials.\n\n' +
        'Error: ' + (error instanceof Error ? error.message : 'Unknown error'),
      { parse_mode: 'HTML' }
    )
  }

  // Save credentials
  await db
    .update(schema.users)
    .set({
      apiKey,
      apiSecret,
      passphrase,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.telegramId, ctx.from!.id))

  // Try to delete the message containing credentials
  try {
    await ctx.deleteMessage()
  } catch {
    // Can't delete in some contexts
  }

  await ctx.reply(
    '✅ <b>Account connected!</b>\n\n' +
      'You now have access to:\n' +
      '• /status - View your positions\n' +
      '• /margin - Set margin alerts\n' +
      '• /liquidation - Set liquidation alerts\n\n' +
      '🔒 Your credentials are stored securely.',
    { parse_mode: 'HTML' }
  )
})

// /disconnect - Remove API credentials
privateCommands.command('disconnect', async (ctx) => {
  await db
    .update(schema.users)
    .set({
      apiKey: null,
      apiSecret: null,
      passphrase: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.telegramId, ctx.from!.id))

  await ctx.reply(
    '✅ Account disconnected. Your API credentials have been removed.\n\n' +
      'You can still use public features like price alerts.'
  )
})

// /status - View positions
privateCommands.command('status', async (ctx) => {
  if (!requireAuth(ctx)) return

  const client = new LNMarketsClient({
    credentials: {
      apiKey: ctx.user!.apiKey!,
      apiSecret: ctx.user!.apiSecret!,
      passphrase: ctx.user!.passphrase!,
    },
  })

  try {
    const [balance, positions, crossPosition] = await Promise.all([
      client.getBalance(),
      client.getOpenPositions(),
      client.getCrossPosition(),
    ])

    const ticker = priceFeed.ticker
    const currentPrice = ticker?.lastPrice || 0

    let message =
      `📊 <b>Account Status</b>\n\n` +
      `💰 Balance: <b>${(balance.balance / 100_000_000).toFixed(8)} BTC</b>\n` +
      `   (${balance.balance.toLocaleString()} sats)\n` +
      `📈 Available: ${balance.available.toLocaleString()} sats\n`

    if (currentPrice) {
      message += `\n💵 BTC Price: $${currentPrice.toLocaleString()}\n`
    }

    // Isolated positions
    if (positions.length > 0) {
      message += `\n<b>Isolated Positions:</b>\n`
      for (const pos of positions) {
        const plEmoji = pos.pl >= 0 ? '🟢' : '🔴'
        const liqDistance = ((Math.abs(currentPrice - pos.liquidationPrice) / currentPrice) * 100).toFixed(1)
        message +=
          `\n${pos.side === 'long' ? '📈' : '📉'} <b>${pos.side.toUpperCase()}</b> ${pos.leverage}x\n` +
          `   Entry: $${pos.entryPrice.toLocaleString()}\n` +
          `   Margin: ${pos.margin.toLocaleString()} sats\n` +
          `   ${plEmoji} P&L: ${pos.pl.toLocaleString()} sats (${pos.plPercent.toFixed(1)}%)\n` +
          `   🚨 Liq: $${pos.liquidationPrice.toLocaleString()} (${liqDistance}% away)\n`
      }
    }

    // Cross margin position
    if (crossPosition) {
      const plEmoji = crossPosition.unrealizedPl >= 0 ? '🟢' : '🔴'
      message +=
        `\n<b>Cross Margin:</b>\n` +
        `   Margin: ${crossPosition.margin.toLocaleString()} sats\n` +
        `   ${plEmoji} Unrealized P&L: ${crossPosition.unrealizedPl.toLocaleString()} sats\n`
      if (crossPosition.liquidationPrice) {
        const liqDistance = ((Math.abs(currentPrice - crossPosition.liquidationPrice) / currentPrice) * 100).toFixed(1)
        message += `   🚨 Liq: $${crossPosition.liquidationPrice.toLocaleString()} (${liqDistance}% away)\n`
      }
    }

    if (positions.length === 0 && !crossPosition) {
      message += `\n<i>No open positions</i>`
    }

    await ctx.reply(message, { parse_mode: 'HTML' })
  } catch (error) {
    await ctx.reply(
      '❌ Error fetching status: ' +
        (error instanceof Error ? error.message : 'Unknown error')
    )
  }
})

// /margin <percent> - Set margin alert
privateCommands.command('margin', async (ctx) => {
  if (!requireAuth(ctx)) return

  const args = ctx.message?.text?.split(' ').slice(1) || []

  if (args.length === 0) {
    return ctx.reply(
      '⚠️ <b>Margin Alerts</b>\n\n' +
        'Get notified when your margin drops below a threshold.\n\n' +
        '<b>Usage:</b>\n' +
        '/margin 50 - Alert when margin drops below 50%\n' +
        '/margin 30 repeat - Repeating alert at 30%',
      { parse_mode: 'HTML' }
    )
  }

  const threshold = parseFloat(args[0])
  if (isNaN(threshold) || threshold <= 0 || threshold > 100) {
    return ctx.reply('❌ Invalid percentage. Please enter a number between 1-100.')
  }

  const repeating = args.includes('repeat')

  await db.insert(schema.alerts).values({
    telegramId: ctx.from!.id,
    type: 'margin_below',
    targetValue: threshold,
    repeating,
  })

  await ctx.reply(
    `⚠️ <b>Margin alert set!</b>\n\n` +
      `You'll be notified when any position's margin drops below <b>${threshold}%</b>`,
    { parse_mode: 'HTML' }
  )
})

// /liquidation <percent> - Set liquidation distance alert
privateCommands.command('liquidation', async (ctx) => {
  if (!requireAuth(ctx)) return

  const args = ctx.message?.text?.split(' ').slice(1) || []

  if (args.length === 0) {
    return ctx.reply(
      '🚨 <b>Liquidation Distance Alerts</b>\n\n' +
        'Get notified when price approaches your liquidation level.\n\n' +
        '<b>Usage:</b>\n' +
        '/liquidation 10 - Alert when liquidation is 10% away\n' +
        '/liquidation 5 repeat - Repeating alert at 5%',
      { parse_mode: 'HTML' }
    )
  }

  const distance = parseFloat(args[0])
  if (isNaN(distance) || distance <= 0 || distance > 100) {
    return ctx.reply('❌ Invalid percentage. Please enter a number between 1-100.')
  }

  const repeating = args.includes('repeat')

  await db.insert(schema.alerts).values({
    telegramId: ctx.from!.id,
    type: 'liquidation_distance',
    targetValue: distance,
    repeating,
  })

  await ctx.reply(
    `🚨 <b>Liquidation alert set!</b>\n\n` +
      `You'll be notified when any position is within <b>${distance}%</b> of liquidation`,
    { parse_mode: 'HTML' }
  )
})
