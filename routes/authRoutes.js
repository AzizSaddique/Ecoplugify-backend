import express from 'express';
import authenticate from '../middleware/auth.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.post('/fcm-token', authenticate, async (req, res, next) => {
  try {
    const token = String(req.body?.fcmToken || '').trim();

    if (!token || token.length < 20 || token.length > 4096) {
      return res.status(400).json({
        success: false,
        message: 'A valid FCM token is required',
      });
    }

    await User.findOneAndUpdate(
      { uid: req.user.uid },
      {
        $set: {
          uid: req.user.uid,
          email: req.user.email || `${req.user.uid}@firebase.local`,
          fcmToken: token,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.json({ success: true, data: { saved: true } });
  } catch (error) {
    logger.error(`Save FCM token failed: ${error.message}`);
    next(error);
  }
});

export default router;
