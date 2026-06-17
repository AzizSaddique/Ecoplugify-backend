import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    uid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    displayName: String,
    photoURL: String,
    fcmToken: {
      type: String,
      default: null,
    },
    electricityRate: {
      type: Number,
      default: 15, // INR per kWh
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    preferences: {
      currencySymbol: {
        type: String,
        default: '₹',
      },
      temperatureUnit: {
        type: String,
        enum: ['C', 'F'],
        default: 'C',
      },
      notifications: {
        enabled: {
          type: Boolean,
          default: true,
        },
        onHighUsage: {
          type: Boolean,
          default: true,
        },
        onScheduleTrigger: {
          type: Boolean,
          default: true,
        },
      },
    },
    totalDevices: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);

export default User;
