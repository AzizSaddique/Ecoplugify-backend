import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';
import connectDB from './config/db.js';
import connectRedis from './config/redis.js';
import connectMQTT from './config/mqtt.js';
import initializeFirebase from './config/firebase.js';
import initializeSocket from './sockets/socketServer.js';
import initializeQueues from './queues/index.js';
import startEnergyWorker from './workers/energyWorker.js';
import startScheduleWorker from './workers/scheduleWorker.js';
import startNotificationWorker from './queues/workers/notificationWorker.js';
import { startOfflineDetector } from './services/offlineDetector.js';
import { startCrons } from './cron/notificationCron.js';
import ScheduleService from './services/scheduleService.js';
import logger from './utils/logger.js';

const PORT = process.env.PORT || 5000;

let server;
let scheduleCheckInterval;
let scheduleCheckTimeout;

const startServer = async () => {
  try {
    // Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await connectDB();

    // Connect to Redis
    logger.info('Connecting to Redis...');
    const redisClient = await connectRedis();

    // Initialize Firebase
    logger.info('Initializing Firebase...');
    initializeFirebase();

    // Connect to MQTT
    logger.info('Connecting to MQTT...');
    const mqttClient = await connectMQTT();

    // Initialize queues
    if (redisClient) {
      logger.info('Initializing queues...');
      const queues = await initializeQueues();

      if (queues.energyQueue || queues.scheduleQueue || queues.notificationQueue) {
        logger.info('Starting workers...');
        startEnergyWorker();
        startScheduleWorker();
        startNotificationWorker();
      } else {
        logger.warn('Queues were not initialized. Workers skipped.');
      }
    } else {
      logger.warn('Redis unavailable. Queues and workers skipped.');
    }

    if (!mqttClient) {
      logger.warn('MQTT unavailable. Live device updates will be delayed until reconnect.');
    }

    startOfflineDetector();
    startCrons();

    // Create Express app
    const app = createApp();
  
    // Create HTTP server
    server = http.createServer(app);

    // Initialize Socket.IO
    initializeSocket(server);

    // Start schedule checker aligned to the start of each real minute
    const scheduleService = new ScheduleService();
    const runScheduleCheck = async () => {
      try {
        await scheduleService.checkAndExecuteSchedules();
      } catch (error) {
        logger.error(`Schedule check error: ${error.message}`);
      }
    };

    const scheduleMinuteAlignedChecks = () => {
      const now = new Date();
      const millisecondsUntilNextMinute =
        (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

      scheduleCheckTimeout = setTimeout(async () => {
        await runScheduleCheck();
        scheduleCheckInterval = setInterval(runScheduleCheck, 60000);
      }, millisecondsUntilNextMinute);
    };

    scheduleMinuteAlignedChecks();

    // Start listening
    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error(`Server startup error: ${error.message}`);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('🛑 Shutting down gracefully...');

  // Clear interval
  if (scheduleCheckInterval) {
    clearInterval(scheduleCheckInterval);
  }
  if (scheduleCheckTimeout) {
    clearTimeout(scheduleCheckTimeout);
  }

  // Close server
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Forcing shutdown...');
      process.exit(1);
    }, 10000);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Unhandled rejection
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});

// Start the server
startServer();

export { server };
