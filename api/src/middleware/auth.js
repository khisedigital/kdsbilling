const { verifyAccessToken } = require('../utils/token');
const AppError = require('../utils/AppError');
const tenantConnectionManager = require('../config/tenantConnectionManager');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const tenant = await tenantConnectionManager.getTenantConfig(decoded.tenantId);
    const models = await tenantConnectionManager.getTenantModels(tenant);

    req.auth = decoded;
    req.tenant = tenant;
    req.db = models;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
    }
    next(err);
  }
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    const permissions = req.auth?.permissions || [];
    if (!permissions.includes(permissionKey)) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    }
    next();
  };
}

module.exports = { authMiddleware, requirePermission };
