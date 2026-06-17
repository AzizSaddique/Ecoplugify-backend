import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    location: String,
    category: {
      type: String,
      enum: ['lighting', 'appliance', 'hvac', 'other'],
      default: 'other',
    },
    active: {
      type: Boolean,
      default: true,
    },

    // ✅ Added
    isOnline: {
      type: Boolean,
      default: false,
    },

    relayState: {
      type: String,
      enum: ['ON', 'OFF', 'OFFLINE'],  // ✅ OFFLINE add kiya
      default: 'OFF',
    },
    voltage: { type: Number, default: 0 },
    current: { type: Number, default: 0 },
    power:   { type: Number, default: 0 },
    energy:  { type: Number, default: 0 },
    totalUptime: { type: Number, default: 0 },
    lastUptime: { type: Number, default: 0 },
    lastSeen: Date,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

deviceSchema.index({ userId: 1, active: 1 });

export const Device = mongoose.model('Device', deviceSchema);
export default Device;
