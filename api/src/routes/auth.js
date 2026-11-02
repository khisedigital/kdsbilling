const express = require('express');
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/pin-verify', authController.verifyPin);
router.get('/me', authMiddleware, authController.me);
router.get('/profile', authMiddleware, asyncHandler(authController.getProfile));
router.patch('/profile', authMiddleware, asyncHandler(authController.updateProfile));
router.post('/change-password', authMiddleware, asyncHandler(authController.changePassword));

module.exports = router;
