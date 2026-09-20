/**
 * Structured logging, with personal data left out by construction.
 *
 * The rule is that user ids are fine and names and emails are not, and the rule
 * is easy to break by accident: the obvious way to log a refusal is to say who
 * was refused, and the obvious way to say who is to print their name. A lint
 * rule catches the common shapes, and this keeps the honest path convenient by
 * having the only identity field it accepts be an id.
 *
 * One JSON object per line, because a log is read by a machine first and a
 * person second, and a machine cannot reliably parse a sentence.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * The fields a log line may carry.
 *
 * Closed on purpose. Anything not here has to be added deliberately, which is
 * the moment to ask whether it is somebody's name.
 */
export interface LogFields {
  userId?: string
  officeId?: string
  roomId?: string
  deviceId?: string
  connectionId?: string
  callId?: string
  knockId?: string
  /** A refusal's stable code, never its message. */
  code?: string
  /** How long something took, in milliseconds. */
  ms?: number
  count?: number
  /** Anything else, as long as it is a number or a flag rather than prose. */
  [key: string]: string | number | boolean | undefined
}

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** A logger that carries these fields on every line. One per connection. */
  child(fields: LogFields): Logger
}

export interface LoggerOptions {
  level?: LogLevel
  /** Where lines go. Injectable so tests can read them. */
  write?: (line: string) => void
  /** The clock, for tests that assert on a timestamp. */
  now?: () => Date
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = 'info',
    write = (line: string) => process.stdout.write(`${line}\n`),
    now = () => new Date(),
  } = options

  const threshold = ORDER[level]

  const make = (bound: LogFields): Logger => {
    const emit = (severity: LogLevel, message: string, fields?: LogFields) => {
      if (ORDER[severity] < threshold) return
      // ISO 8601 in UTC with the zone explicit, like every other instant that
      // leaves this process. Nothing here formats a date for a person.
      write(JSON.stringify({ at: now().toISOString(), level: severity, message, ...bound, ...fields }))
    }
    return {
      debug: (message, fields) => emit('debug', message, fields),
      info: (message, fields) => emit('info', message, fields),
      warn: (message, fields) => emit('warn', message, fields),
      error: (message, fields) => emit('error', message, fields),
      child: (fields) => make({ ...bound, ...fields }),
    }
  }

  return make({})
}

/** A logger that discards everything. For tests about something else. */
export function silentLogger(): Logger {
  const noop = (): void => {}
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  }
  return logger
}
