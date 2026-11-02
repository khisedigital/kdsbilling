const config = require('../config');
const AppError = require('../utils/AppError');

function normalizeUser(value) {
  return String(value || '').trim().toLowerCase();
}

function allowedAdminUsernames() {
  const email = normalizeUser(config.platform.adminEmail);
  const configured = normalizeUser(config.platform.adminUsername);
  const localPart = email.includes('@') ? email.split('@')[0] : email;
  return new Set(
    [email, configured, localPart, 'admin'].filter(Boolean)
  );
}

function isValidAdminUsername(username) {
  const value = normalizeUser(username);
  if (!value) return false;
  return allowedAdminUsernames().has(value);
}

function isValidAdminPassword(password) {
  return String(password || '') === String(config.platform.adminPassword || '');
}

function platformAuth(req, res, next) {
  const apiKey = req.headers['x-platform-key'];
  const username = req.headers['x-platform-user'];

  if (!isValidAdminPassword(apiKey)) {
    return next(new AppError('Invalid username or password', 401, 'UNAUTHORIZED'));
  }

  // Username is optional for API tools; when sent it must match an allowed admin identity.
  if (username != null && String(username).trim() !== '') {
    if (!isValidAdminUsername(username)) {
      return next(new AppError('Invalid username or password', 401, 'UNAUTHORIZED'));
    }
  }

  next();
}

module.exports = platformAuth;
module.exports.isValidAdminUsername = isValidAdminUsername;
module.exports.isValidAdminPassword = isValidAdminPassword;
