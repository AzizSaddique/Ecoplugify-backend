import { Queue } from 'bullmq';
import logger from '../utils/logger.js';

let energyQueue = null;
let scheduleQueue = null;
let notificationQueue = null;

export const initializeQueues = async () => {
  try {
    if (
      !process.env.REDIS_HOST ||
      !process.env.REDIS_PORT ||
      !process.env.REDIS_PASSWORD
    ) {
      logger.warn(
        'Redis queue settings are incomplete. Queue initialization skipped.'
      );
      return { energyQueue: null, scheduleQueue: null, notificationQueue: null };
    }

    const redisConnection = {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };

    logger.info(
      `Connecting to Redis for queues: ${redisConnection.host}:${redisConnection.port}`
    );

    energyQueue = new Queue('energy-processing', {
      connection: redisConnection,
      skipVersionCheck: true,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    scheduleQueue = new Queue('schedule-execution', {
      connection: redisConnection,
      skipVersionCheck: true,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    notificationQueue = new Queue('notification-processing', {
      connection: redisConnection,
      skipVersionCheck: true,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    logger.info('Queues initialized');
    return { energyQueue, scheduleQueue, notificationQueue };
  } catch (error) {
    logger.error(`Queue initialization error: ${error.message}`);
    energyQueue = null;
    scheduleQueue = null;
    notificationQueue = null;
    return { energyQueue, scheduleQueue, notificationQueue };
  }
};

export const getEnergyQueue = () => energyQueue;
export const getScheduleQueue = () => scheduleQueue;
export const getNotificationQueue = () => notificationQueue;

export default initializeQueues;
