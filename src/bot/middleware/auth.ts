import { Context, NextFunction } from 'grammy'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'

export interface AuthContext extends Context {
  user?: typeof schema.users.$inferSelect
  isAuthenticated: boolean
}

export async function authMiddleware(
  ctx: AuthContext,
  next: NextFunction
): Promise<void> {
  const telegramId = ctx.from?.id

  if (!telegramId) {
    ctx.isAuthenticated = false
    return next()
  }

  // Try to find existing user
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.telegramId, telegramId))
    .limit(1)

  if (user) {
    ctx.user = user
    ctx.isAuthenticated = !!user.apiKey
  } else {
    // Create new public user
    await db.insert(schema.users).values({
      telegramId,
      username: ctx.from?.username,
    })
    ctx.isAuthenticated = false
  }

  return next()
}

export function requireAuth(ctx: AuthContext): boolean {
  if (!ctx.isAuthenticated) {
    ctx.reply(
      '🔒 This feature requires connecting your LN Markets account.\n\n' +
        'Use /connect to link your API credentials.'
    )
    return false
  }
  return true
}
