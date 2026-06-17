import { Server } from 'socket.io';
import logger from '../utils/logger.js';

let io = null;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    socket.on('auth', (data) => {
      const { userId } = data;
      socket.join(`user:${userId}`);
      socket.join(`user:${userId}:devices`);
      logger.info(`User ${userId} authenticated on socket ${socket.id}`);
    });

    socket.on('subscribe-device', (data) => {
      const { deviceId, userId } = data;
      socket.join(`device:${deviceId}`);
      logger.info(`Socket ${socket.id} subscribed to device ${deviceId}`);
    });

    socket.on('unsubscribe-device', (data) => {
      const { deviceId } = data;
      socket.leave(`device:${deviceId}`);
      logger.info(`Socket ${socket.id} unsubscribed from device ${deviceId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error: ${error}`);
    });
  });

  logger.info('Socket.IO initialized');
  return io;
};

export const getSocketIO = () => io;

export const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

export const emitToDevice = (deviceId, event, data) => {
  if (io) {
    io.to(`device:${deviceId}`).emit(event, data);
  }
};

export default initializeSocket;
