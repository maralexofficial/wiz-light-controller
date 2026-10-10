
'use strict';

function success(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    timestamp: Date.now(),
    data,
    error: null
  });
}

function failure(
  res,
  statusCode,
  code,
  message,
  details = null
) {
  const error = {
    code,
    message
  };

  if (details !== null) {
    error.details = details;
  }

  return res.status(statusCode).json({
    success: false,
    timestamp: Date.now(),
    data: null,
    error
  });
}

module.exports = {
  success,
  failure
};
