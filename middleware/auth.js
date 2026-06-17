import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';
import { verifyToken } from '../config/firebase.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return next(new AppError('No token provided', 401));
    }

    const decodedToken = await verifyToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };
    next();
  } catch (error) {
    logger.error(`Auth error: ${error.message}`);
    next(new AppError('Invalid or expired token', 401));
  }
};

export default authenticate;
