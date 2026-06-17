import { body, param, query, validationResult } from 'express-validator';

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

// Device validation rules
export const validateDeviceLink = [
  body('deviceId').trim().notEmpty().withMessage('Device ID is required'),
  body('name').trim().notEmpty().withMessage('Device name is required'),
  body('location').optional().trim(),
  body('category').optional().isIn(['lighting', 'appliance', 'hvac', 'other']),
  body('forceClaim').optional().isBoolean(),
  validate,
];

// Energy query validation
export const validateEnergyQuery = [
  param('deviceId').trim().notEmpty(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  validate,
];

// Schedule validation
export const validateScheduleCreate = [
  body('deviceId').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('action').isIn(['ON', 'OFF']),
  body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('Invalid time format'),
  body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('Invalid time format'),
  body('durationMinutes').optional().isInt({ min: 1, max: 1440 }),
  body('daysOfWeek').optional().isArray(),
  body('mode').optional().isIn(['once', 'daily', 'custom']),
  validate,
];

// Relay control validation
export const validateRelayControl = [
  body('deviceId').trim().notEmpty(),
  body('action').isIn(['ON', 'OFF']),
  validate,
];

export const validatePresetCommand = [
  body('deviceId').trim().notEmpty(),
  body('preset').trim().notEmpty(),
  validate,
];

export default { validate };
