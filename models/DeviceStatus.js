import mongoose from 'mongoose';

const deviceStatusSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceName: String,
    isOnline: { type: Boolean, default: false, index: true },
    lastSeen: { type: Date, default: null, index: true },
    lastPower: { type: Number, default: 0 },
    lastVoltage: { type: Number, default: 0 },
    lastCurrent: { type: Number, default: 0 },
    lastUptime: { type: Number, default: 0 },
    relayState: {
      type: String,
      enum: ['ON', 'OFF', 'OFFLINE'],
      default: 'OFF',
    },
    relayOnSince: { type: Date, default: null },
    offlineNotifiedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

deviceStatusSchema.index({ isOnline: 1, lastSeen: 1 });

export const DeviceStatus = mongoose.model('DeviceStatus', deviceStatusSchema);
export default DeviceStatus;
