'use strict';

const express = require('express');
const authMiddleware = require('./middleware/auth.middleware');
const response = require('./utils/response');
const logger = require('./utils/logger');

const bulbsRouter = require('./routes/bulbs.routes');
const systemRouter = require('./routes/system.routes');
const groupsRouter = require('./routes/groups.routes');

const app = express();

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json({
  limit: '16kb',
  strict: true
}));

app.get('/', (req, res) => {
  return response.success(res, {
    name: 'WiZ Light Controller API',
    version: '2.0.0',
    status: 'running',
    documentation: 'Use the /api endpoints.'
  });
});

app.use('/api', authMiddleware);

app.use('/api', bulbsRouter);
app.use('/api', systemRouter);
app.use('/api', groupsRouter);

app.use((req, res) => {
  return response.failure(
    res,
    404,
    'ENDPOINT_NOT_FOUND',
    'Endpoint not found.'
  );
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (
    error instanceof SyntaxError &&
    error.status === 400 &&
    Object.prototype.hasOwnProperty.call(error, 'body')
  ) {
    logger.warn(
      `[API] Invalid JSON request | method=${req.method} | path=${req.path}`
    );

    return response.failure(
      res,
      400,
      'INVALID_JSON',
      'Invalid JSON request body.'
    );
  }

  if (error.type === 'entity.too.large') {
    logger.warn(
      `[API] Request body too large | method=${req.method} | path=${req.path}`
    );

    return response.failure(
      res,
      413,
      'REQUEST_TOO_LARGE',
      'Request body is too large.'
    );
  }

  if (error.type === 'entity.parse.failed') {
    logger.warn(
      `[API] Invalid JSON request | method=${req.method} | path=${req.path}`
    );

    return response.failure(
      res,
      400,
      'INVALID_JSON',
      'Invalid JSON request body.'
    );
  }

  logger.error(
    `[API] Internal server error | method=${req.method} | path=${req.path}`,
    error
  );

  return response.failure(
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'Internal server error.'
  );
});

module.exports = app;