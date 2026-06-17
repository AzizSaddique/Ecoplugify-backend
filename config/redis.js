import { createClient } from 'redis';
import logger from '../utils/logger.js';

let redisClient = null;

export const connectRedis = async () => {
  try {
    // Use REDIS_URL if available (recommended), otherwise construct from host/port/password
    const redisConfig = process.env.REDIS_URL 
      ? process.env.REDIS_URL
      : `redis://${process.env.REDIS_PASSWORD ? `default:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

    redisClient = createClient({
      url: redisConfig,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
      },
    });

    redisClient.on('error', (err) => logger.error(`Redis error: ${err}`));
    redisClient.on('connect', () => logger.info('Redis connected'));

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error(`Redis connection error: ${error.message}`);
    redisClient = null;
    return null;
  }
};

export const getRedis = () => redisClient;

export default connectRedis;
