import express from 'express';
import deviceController from '../controllers/deviceController.js';
import { validateDeviceLink } from '../middleware/validation.js';
import authenticate from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(authenticate);

// Device endpoints
router.post('/link', validateDeviceLink, deviceController.linkDevice);
router.get('/', deviceController.getUserDevices);
router.patch('/:deviceId', deviceController.updateDevice);
router.get('/:deviceId', deviceController.getDevice);
router.delete('/:deviceId', deviceController.unlinkDevice);

export default router;
