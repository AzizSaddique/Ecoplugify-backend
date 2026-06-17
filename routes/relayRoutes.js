import express from 'express';
import relayController from '../controllers/relayController.js';
import {
  validatePresetCommand,
  validateRelayControl,
} from '../middleware/validation.js';
import authenticate from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(authenticate);

// Relay endpoints
router.post('/', validateRelayControl, relayController.controlRelay);
router.post('/preset', validatePresetCommand, relayController.setPreset);

export default router;
