
'use strict';

const express = require('express');
const config = require('./config');
const authMiddleware = require('./middleware/auth.middleware');

const bulbsRouter = require('./routes/bulbs.routes');
const systemRouter = require('./routes/system.routes');

const app = express();

app.disable('x-powered-by');

app.use(express.json({
  limit: '16kb',
  strict: true
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/', (req, res) => {
  return res.status(200).json({
    name: 'WiZ Light Controller API',
    version: '2.0.0',
    status: 'running',
    documentation: 'Use the /api endpoints.'
  });
});

app.use('/api', authMiddleware);

app.use('/api', bulbsRouter);
app.use('/api', systemRouter);

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: 'Endpoint not found.'
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON request body.'
    });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'Request body is too large.'
    });
  }

  console.error('[API] Internal server error:', error.message);

  return res.status(500).json({
    success: false,
    error: 'Internal server error.'
  });
});

module.exports = app;
