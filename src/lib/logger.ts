import { env } from './env'

export type LogChannel = 'AUTH' | 'REPOSITORY' | 'CONNECTIVITY' | 'SYNC' | 'UI' | 'PWA'

const enabled = env.isDev && !env.isTest

function write(level: 'debug' | 'info' | 'warn' | 'error', channel: LogChannel, message: string, data?: unknown) {
  if (!enabled && level === 'debug') return
  if (env.isTest) return
  const line = `[${channel}] ${message}`
  if (data === undefined) console[level](line)
  else console[level](line, data)
}

export const logger = {
  debug: (channel: LogChannel, message: string, data?: unknown) => write('debug', channel, message, data),
  info: (channel: LogChannel, message: string, data?: unknown) => write('info', channel, message, data),
  warn: (channel: LogChannel, message: string, data?: unknown) => write('warn', channel, message, data),
  error: (channel: LogChannel, message: string, data?: unknown) => write('error', channel, message, data),
}
