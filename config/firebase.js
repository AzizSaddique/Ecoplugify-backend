import admin from 'firebase-admin';
import { createPrivateKey } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMeaningfulValue = value =>
  Boolean(value) &&
  !String(value).includes('your-') &&
  !String(value).includes('private-key') &&
  !String(value).includes('client-email');

const hasFirebaseServiceAccount = () =>
  isMeaningfulValue(process.env.FIREBASE_PROJECT_ID) &&
  isMeaningfulValue(process.env.FIREBASE_PRIVATE_KEY) &&
  isMeaningfulValue(process.env.FIREBASE_CLIENT_EMAIL);

const decodeEscapedNewlines = value =>
  String(value || '')
    .trim()
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');

const stripWrappingQuotes = value => {
  const trimmed = String(value || '').trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];

  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
};

const extractPrivateKeyFromJsonFragment = value => {
  const match = value.match(/"private_key"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  return match ? match[1] : value;
};

const normalizePrivateKey = value => {
  let privateKey = stripWrappingQuotes(decodeEscapedNewlines(value));

  if (!privateKey) {
    return privateKey;
  }

  if (privateKey.startsWith('{')) {
    try {
      const parsed = JSON.parse(privateKey);
      privateKey = parsed.private_key || privateKey;
    } catch {
      privateKey = extractPrivateKeyFromJsonFragment(privateKey);
    }
  } else {
    privateKey = extractPrivateKeyFromJsonFragment(privateKey);
  }

  return stripWrappingQuotes(decodeEscapedNewlines(privateKey));
};

const validatePrivateKey = privateKey => {
  if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      'FIREBASE_PRIVATE_KEY must be the service-account private_key PEM value'
    );
  }

  if (!privateKey.includes('-----END PRIVATE KEY-----')) {
    throw new Error('FIREBASE_PRIVATE_KEY is missing the PEM end marker');
  }

  const keyObject = createPrivateKey(privateKey);
  if (keyObject.type !== 'private' || keyObject.asymmetricKeyType !== 'rsa') {
    throw new Error('FIREBASE_PRIVATE_KEY must be an RSA private key');
  }
};

const loadServiceAccountFromFile = () => {
  try {
    const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const serviceAccountPath = configuredPath
      ? path.resolve(configuredPath)
      : path.resolve(__dirname, '..', 'serviceAccountKey.json');

    if (!fs.existsSync(serviceAccountPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  } catch (error) {
    logger.warn(`Firebase service account file ignored: ${error.message}`);
    return null;
  }
};

const decodeJwtPayload = token => {
  const payload = token?.split('.')[1];

  if (!payload) {
    throw new Error('Malformed token');
  }

  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + (4 - padding), '=') : normalized;

  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
};

export const initializeFirebase = () => {
  try {
    if (admin.apps.length) {
      return admin;
    }

    const fileServiceAccount = loadServiceAccountFromFile();

    if (fileServiceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(fileServiceAccount),
      });

      logger.info('Firebase initialized from service account file');
      return admin;
    }

    if (!hasFirebaseServiceAccount()) {
      logger.warn(
        'Firebase service-account credentials are missing. Falling back to development auth mode.'
      );
      return null;
    }

    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    validatePrivateKey(privateKey);

    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: 'key-id',
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: 'client-id',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    logger.info('Firebase initialized');
    return admin;
  } catch (error) {
    logger.warn(`Firebase initialization skipped: ${error.message}`);
    return null;
  }
};

export const initFirebase = initializeFirebase;

export const isFirebaseReady = () => Boolean(admin.apps.length);

export { admin };

export const verifyToken = async (token) => {
  try {
    if (!admin.apps.length) {
      initializeFirebase();
    }

    if (!admin.apps.length) {
      if (process.env.NODE_ENV === 'development') {
        const decodedPayload = decodeJwtPayload(token);

        return {
          uid: decodedPayload.user_id || decodedPayload.sub,
          email: decodedPayload.email,
          ...decodedPayload,
        };
      }

      throw new Error('Firebase Admin SDK is not initialized');
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    logger.error(`Token verification error: ${error.message}`);
    throw error;
  }
};

export default initializeFirebase;
