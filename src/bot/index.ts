import { Bot } from 'grammy'
import { authMiddleware, type AuthContext } from './middleware/auth.js'
import { publicCommands } from './commands/public.js'
import { privateCommands } from './commands/private.js'

export function createBot(token: string): Bot<AuthContext> {
  const bot = new Bot<AuthContext>(token)

  // Global middleware
  bot.use(authMiddleware)

  // Register command handlers
  bot.use(publicCommands)
  bot.use(privateCommands)

  // Handle unknown commands
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(
        '❓ Unknown command. Use /start to see available commands.'
      )
    }
  })

  // Error handling
  bot.catch((err) => {
    console.error('Bot error:', err)
  })

  return bot
}
