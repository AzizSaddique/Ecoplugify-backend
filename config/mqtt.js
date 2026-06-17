import mqtt from 'mqtt';
import logger from '../utils/logger.js';
import { getEnergyQueue } from '../queues/index.js';
import Device from '../models/Device.js';
import {
  processDataPayload,
  processStatusPayload,
} from '../services/alertProcessor.js';

let mqttClient = null;

export const connectMQTT = async () => {
  try {
    const protocol = process.env.MQTT_PROTOCOL || 'mqtts';
    const port     = protocol === 'mqtts' ? 8883 : 1883;

    const brokerUrl = process.env.MQTT_BROKER.includes(':')
      ? process.env.MQTT_BROKER
      : `${protocol}://${process.env.MQTT_BROKER}:${port}`;

    const options = {
      protocol,
      username:           process.env.MQTT_USERNAME,
      password:           process.env.MQTT_PASSWORD,
      clientId:           `ecoplugify-backend-${Date.now()}`,
      clean:              true,
      reconnectPeriod:    3000,
      connectTimeout:     30000,
      rejectUnauthorized: false,
    };

    mqttClient = mqtt.connect(brokerUrl, options);

    mqttClient.on('connect', () => {
      logger.info('MQTT connected');

      // ✅ FIXED — match ESP32 topics exactly
      const topics = [
        'ecoplugify/v1/+/data',     // sensor readings
        'ecoplugify/v1/+/status',   // online/offline
        'ecoplugify/v1/+/meta',     // firmware/device metadata
      ];

      topics.forEach(topic => {
        mqttClient.subscribe(topic, (err) => {
          if (err) logger.error(`Subscribe error ${topic}: ${err}`);
          else     logger.info(`Subscribed: ${topic}`);
        });
      });
    });

    mqttClient.on('message', async (topic, message) => {
      try {
        const parts = topic.split('/');
        // ecoplugify / v1 / plug1 / data
        //     0       1     2       3
        if (parts.length < 4) return;

        const deviceId    = parts[2];  // plug1, plug2, etc
        const messageType = parts[3];  // data, status

        const payload = JSON.parse(message.toString());
        const device = await Device.findOne({ deviceId, active: true }).lean();

        if (messageType === 'data') {
          logger.debug(`Reading received from ${deviceId}`);

          // ✅ Push to energy queue
          const energyQueue = getEnergyQueue();
          if (energyQueue) {
            await energyQueue.add('process-reading', {
              deviceId,
              payload,
              timestamp: new Date(),
            });
          }

          if (device) {
            processDataPayload(
              deviceId,
              payload,
              device.userId,
              device.name || deviceId,
            ).catch(error => {
              logger.error(`Alert processor data error: ${error.message}`);
            });
          }
        }

        if (messageType === 'status') {
          const isOnline = payload.relay !== 'OFFLINE';
          logger.info(`Device ${deviceId} ${isOnline ? 'connected' : 'disconnected'}`);

          // Online/offline status update
          const energyQueue = getEnergyQueue();
          if (energyQueue) {
            await energyQueue.add('update-status', {
              deviceId,
              isOnline,
              relay:    payload.relay,
              timestamp: new Date(),
            });
          }

          if (device) {
            processStatusPayload(
              deviceId,
              payload,
              device.userId,
              device.name || deviceId,
            ).catch(error => {
              logger.error(`Alert processor status error: ${error.message}`);
            });
          }
        }

      } catch (error) {
        logger.error(`MQTT message error on ${topic}: ${error.message}`);
      }
    });

    mqttClient.on('error',      err => logger.error(`MQTT error: ${err.message}`));
    mqttClient.on('disconnect', ()  => logger.warn('MQTT disconnected'));
    mqttClient.on('reconnect',  ()  => logger.info('MQTT reconnecting...'));

    return mqttClient;

  } catch (error) {
    logger.error(`MQTT connection error: ${error.message}`);
    mqttClient = null;
    return null;
  }
};

export const publishMQTT = (topic, message) => {
  if (!mqttClient?.connected) {
    logger.error('MQTT not connected');
    return false;
  }
  mqttClient.publish(topic, typeof message === 'string' ? message : JSON.stringify(message));
  return true;
};

export const getMQTT = () => mqttClient;
export default connectMQTT;
