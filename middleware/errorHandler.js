import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message = err.message || 'Internal Server Error';

  logger.error(`Error: ${err.message}`, {
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
  });

  // Wrong MongoDB ID error
  if (err.name === 'CastError') {
    const message = `Resource not found: ${err.path}`;
    err = { statusCode: 400, message };
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const message = `Duplicate field value entered`;
    err = { statusCode: 400, message };
  }

  // JWT error
  if (err.name === 'JsonWebTokenError') {
    const message = `Invalid JWT token`;
    err = { statusCode: 401, message };
  }

  // JWT expired
  if (err.name === 'TokenExpiredError') {
    const message = `JWT token expired`;
    err = { statusCode: 401, message };
  }

  res.status(err.statusCode).json({
    success: false,
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;
