const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config/config');
const logger = require('./utils/logger');

const orderRoutes = require('./api/routes/orders');
const tokenRoutes = require('./api/routes/tokens');
const userRoutes = require('./api/routes/users');
const dexRoutes = require('./api/routes/dex');
const priceRoutes = require('./api/routes/prices');

const app = express();

const corsConfig = config.cors || {};
const isCorsEnabled = corsConfig.enabled !== false;
function normalizeOrigin(origin) {
  if (!origin) {
    return '';
  }

  if (origin === '*') {
    return '*';
  }

  const trimmed = origin.trim();
  if (trimmed.length === 0) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (error) {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

const configuredOrigins = isCorsEnabled
  ? (corsConfig.origins && corsConfig.origins.length > 0 ? corsConfig.origins : ['*'])
  : [];
const normalizedOrigins = isCorsEnabled
  ? Array.from(
      new Set(
        configuredOrigins
          .map((origin) => normalizeOrigin(origin))
          .filter((origin) => origin && origin.length > 0),
      ),
    )
  : [];
const allowAllOrigins = isCorsEnabled && normalizedOrigins.includes('*');
const explicitAllowedOrigins = allowAllOrigins
  ? normalizedOrigins.filter((origin) => origin !== '*')
  : normalizedOrigins;
const allowCredentialsHeader = corsConfig.allowCredentials ? 'true' : null;
const allowedMethodsHeader =
  isCorsEnabled && corsConfig.methods && corsConfig.methods.length > 0
    ? corsConfig.methods.join(',')
    : null;
const allowedHeadersHeader =
  isCorsEnabled && corsConfig.allowedHeaders && corsConfig.allowedHeaders.length > 0
    ? corsConfig.allowedHeaders.join(',')
    : null;
const exposedHeadersHeader =
  isCorsEnabled && corsConfig.exposedHeaders && corsConfig.exposedHeaders.length > 0
    ? corsConfig.exposedHeaders.join(',')
    : null;
const maxAgeHeader =
  isCorsEnabled && corsConfig.maxAge !== null && corsConfig.maxAge !== undefined
    ? String(corsConfig.maxAge)
    : null;

if (isCorsEnabled) {
  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
    const originIsAllowed =
      !requestOrigin ||
      allowAllOrigins ||
      explicitAllowedOrigins.includes(normalizedRequestOrigin);

    if (!originIsAllowed) {
      logger.warn('Blocked request from disallowed origin', {
        origin: requestOrigin,
        method: req.method,
        path: req.originalUrl,
      });

      if (req.method === 'OPTIONS') {
        return res.sendStatus(403);
      }

      return res.status(403).json({
        error: 'cors_not_allowed',
        message: 'The request origin is not permitted by the server CORS policy.',
      });
    }

    if (requestOrigin) {
      const allowOriginHeader =
        allowAllOrigins && !corsConfig.allowCredentials ? '*' : requestOrigin;
      res.header('Access-Control-Allow-Origin', allowOriginHeader);
    } else if (allowAllOrigins && !corsConfig.allowCredentials) {
      res.header('Access-Control-Allow-Origin', '*');
    }

    res.header('Vary', 'Origin');

    if (allowCredentialsHeader) {
      res.header('Access-Control-Allow-Credentials', allowCredentialsHeader);
    }

    if (exposedHeadersHeader) {
      res.header('Access-Control-Expose-Headers', exposedHeadersHeader);
    }

    if (allowedMethodsHeader) {
      res.header('Access-Control-Allow-Methods', allowedMethodsHeader);
    }

    if (allowedHeadersHeader) {
      res.header('Access-Control-Allow-Headers', allowedHeadersHeader);
    } else if (req.headers['access-control-request-headers']) {
      res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
    }

    if (maxAgeHeader) {
      res.header('Access-Control-Max-Age', maxAgeHeader);
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  });
}

app.use(bodyParser.json());

app.use('/api/orders', orderRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dex', dexRoutes);
app.use('/api/prices', priceRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function startServer(port = config.port, options = {}) {
  const { announce = false } = options;

  const server = app.listen(port, () => {
    const addressInfo = server.address();
    const actualPort = typeof addressInfo === 'string' ? port : addressInfo.port;
    const host = typeof addressInfo === 'string' ? addressInfo : addressInfo.address;
    const displayHost = host === '::' || host === '0.0.0.0' ? 'localhost' : host;
    const baseUrl = `http://${displayHost}:${actualPort}`;
    const healthCheckUrl = `${baseUrl}/health`;

    logger.info('Backend API server started', {
      port: actualPort,
      host,
      healthCheckUrl,
      cors: {
        enabled: isCorsEnabled,
        allowAllOrigins,
        allowedOrigins: allowAllOrigins ? ['*'] : explicitAllowedOrigins,
        allowCredentials: Boolean(corsConfig.allowCredentials),
      },
    });

    if (announce) {
      // eslint-disable-next-line no-console
      console.log(`Backend API server listening on ${baseUrl}`);
      // eslint-disable-next-line no-console
      console.log(`Health check available at ${healthCheckUrl}`);
    }
  });

  server.on('error', (error) => {
    logger.error('Backend API server failed to start', { error: error.message });

    if (announce) {
      // eslint-disable-next-line no-console
      console.error('Failed to start backend server:', error.message);
    }
  });

  return server;
}

module.exports = {
  app,
  startServer,
};

if (require.main === module) {
  startServer(config.port, { announce: true });
}
