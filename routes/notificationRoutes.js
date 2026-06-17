import express from 'express';
import authenticate from '../middleware/auth.js';
import notificationController from '../controllers/notificationController.js';

const router = express.Router();

router.use(authenticate);

router.get('/', notificationController.getNotifications);
router.put('/read-all', notificationController.markAllRead);
router.delete('/clear-all', notificationController.clearAll);
router.get('/unread-count', notificationController.getUnreadCount);
router.get('/settings', notificationController.getSettings);
router.put('/settings', notificationController.updateSettings);
router.put('/:id/read', notificationController.markAsRead);
router.delete('/:id', notificationController.deleteNotification);

export default router;
