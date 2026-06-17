import { Worker } from 'bullmq';
import logger from '../utils/logger.js';
import { Schedule } from '../models/Schedule.js';
import { publishMQTT } from '../config/mqtt.js';
import { getSocketIO } from '../sockets/socketServer.js';

export const startScheduleWorker = () => {
  const redisConnection = {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };

  const worker = new Worker(
    'schedule-execution',
    async job => {
      try {
        const { scheduleId, deviceId, userId, action, trigger = 'start' } = job.data;

        const topic = `ecoplugify/v1/${deviceId}/relay`;
        publishMQTT(topic, action);

        const io = getSocketIO();
        if (io) {
          io.to(`user:${userId}`).emit('schedule:trigger', {
            scheduleId,
            deviceId,
            action,
            trigger,
            timestamp: new Date(),
          });
        }

        logger.info(
          `Schedule executed: ${scheduleId} -> ${deviceId} = ${action} (${trigger})`
        );
        return { success: true };
      } catch (error) {
        logger.error(`Schedule worker error: ${error.message}`);
        throw error;
      }
    },
    {
      skipVersionCheck: true,
      connection: redisConnection,
      concurrency: 3,
    }
  );

  worker.on('failed', (job, error) => {
    logger.error(`Schedule job ${job.id} failed: ${error.message}`);
  });

  logger.info('Schedule worker started');
  return worker;
};

export default startScheduleWorker;
