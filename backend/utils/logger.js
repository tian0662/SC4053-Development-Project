const levels = ['debug', 'info', 'warn', 'error'];

function log(level, message, meta = {}) {
  if (!levels.includes(level)) {
    throw new Error(`Unsupported log level: ${level}`);
  }
  const timestamp = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ timestamp, level, message, ...meta }));
}

module.exports = {
  log,
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
