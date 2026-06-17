import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import logger from './utils/logger.js';
import errorHandler from './middleware/errorHandler.js';
import apiLimiter from './middleware/rateLimiter.js';

// Import routes
import deviceRoutes from './routes/deviceRoutes.js';
import energyRoutes from './routes/energyRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import relayRoutes from './routes/relayRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import authRoutes from './routes/authRoutes.js';

export const createApp = () => {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));

  // Body parser middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Rate limiter
  app.use('/api/', apiLimiter);

  // Request logging middleware
  app.use((req, res, next) => {
    if (req.path !== '/health' && req.path !== '/api/health') {
      logger.debug(`${req.method} ${req.path}`);
    }
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      apiVersion: '1.0',
    });
  });

  // Health check endpoint (no /api prefix for easy testing)
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      apiVersion: '1.0',
    });
  });

  // API routes
  app.use('/api/devices', deviceRoutes);
  app.use('/api/energy', energyRoutes);
  app.use('/api/schedule', scheduleRoutes);
  app.use('/api/schedules', scheduleRoutes);
  app.use('/api/relay', relayRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/auth', authRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
    });
  });

  // Error handling middleware
  app.use(errorHandler);

  return app;
};

export default createApp;
