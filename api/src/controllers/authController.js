const authService = require('../services/authService');
const profileService = require('../services/profileService');

async function login(req, res, next) {
  try {
    const { shopCode, mobile, phone, email, password, deviceInfo } = req.body;
    const result = await authService.login({ shopCode, mobile, phone, email, password, deviceInfo });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

async function verifyPin(req, res, next) {
  try {
    const { shopCode, userId, pin } = req.body;
    const result = await authService.verifyPin({ shopCode, userId, pin });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({
    success: true,
    data: {
      auth: req.auth,
      tenant: {
        id: req.tenant.id,
        name: req.tenant.name,
        slug: req.tenant.slug,
        currencyCode: req.tenant.currency_code,
        countryCode: req.tenant.country_code,
      },
    },
  });
}

async function getProfile(req, res) {
  const data = await profileService.getProfile(req.db, req.auth.sub);
  res.json({ success: true, data });
}

async function updateProfile(req, res) {
  const data = await profileService.updateProfile(req.db, req.tenant, req.auth.sub, req.body);
  res.json({ success: true, data });
}

async function changePassword(req, res) {
  const data = await profileService.changePassword(req.db, req.auth.sub, req.body);
  res.json({ success: true, data, message: 'Password updated. Please sign in again.' });
}

module.exports = {
  login,
  refresh,
  logout,
  verifyPin,
  me,
  getProfile,
  updateProfile,
  changePassword,
};
