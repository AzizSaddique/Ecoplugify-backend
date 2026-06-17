import mongoose from 'mongoose';

const notificationSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    masterEnabled: { type: Boolean, default: true },
    deviceOffline: { type: Boolean, default: true },
    deviceOnline: { type: Boolean, default: true },
    highPower: { type: Boolean, default: true },
    overVoltage: { type: Boolean, default: true },
    overCurrent: { type: Boolean, default: true },
    relayChange: { type: Boolean, default: false },
    applianceLeftOn: { type: Boolean, default: true },
    dailySummary: { type: Boolean, default: true },
    highCost: { type: Boolean, default: true },
    esp32Reboot: { type: Boolean, default: false },
    calWarning: { type: Boolean, default: true },
    dataLoss: { type: Boolean, default: false },
    systemNotifications: { type: Boolean, default: true },
    smsAlerts: { type: Boolean, default: false },
    phoneCallAlerts: { type: Boolean, default: false },
    powerThreshold: { type: Number, default: 1500, min: 1, max: 100000 },
    costDailyLimit: { type: Number, default: 100, min: 1, max: 1000000 },
    quietHoursEnabled: { type: Boolean, default: false },
    quietStart: { type: String, default: '23:00' },
    quietEnd: { type: String, default: '07:00' },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

notificationSettingsSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

export const NotificationSettings = mongoose.model(
  'NotificationSettings',
  notificationSettingsSchema,
);

export default NotificationSettings;
