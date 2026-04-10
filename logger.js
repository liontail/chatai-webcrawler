const { createLogger, format, transports } = require('winston')
const { combine, timestamp, printf, colorize, simple } = format

const logFormat = printf(function ({ level, message, timestamp }) {
  return `${timestamp} [${level}] ${message}`
})

const logger = createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        simple()
      )
    }),
    new transports.File({
      filename: './logs/crawler.log',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      )
    })
  ]
})

module.exports = logger
