import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'DEVICE_OFFLINE',
  'DEVICE_ONLINE',
  'HIGH_POWER',
  'OVER_VOLTAGE',
  'OVER_CURRENT',
  'RELAY_CHANGED',
  'APPLIANCE_LEFT_ON',
  'HIGH_DAILY_COST',
  'DATA_LOSS',
  'CAL_WARNING',
  'ESP32_REBOOT',
  'DAILY_SUMMARY',
];

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      index: true,
    },
    deviceName: String,
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    priority: {
      type: String,
      enum: ['max', 'high', 'default', 'low'],
      default: 'default',
    },
    channelId: {
      type: String,
      default: 'ecoplugify_info',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    data: mongoose.Schema.Types.Mixed,
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: false },
);

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
