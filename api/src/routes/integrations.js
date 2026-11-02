const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../constants/permissions');
const asyncHandler = require('../utils/asyncHandler');
const shopify = require('../controllers/shopifyController');

// Tenant always comes from the verified JWT (req.tenant / req.db), never from the request body.
const router = express.Router();
router.use(authMiddleware);
router.use(requirePermission(PERMISSIONS.SETTINGS_MANAGE));

router.get('/shopify', asyncHandler(shopify.getStatus));
router.post('/shopify/connect', asyncHandler(shopify.connect));
router.post('/shopify/sync', asyncHandler(shopify.sync));
router.post('/shopify/disconnect', asyncHandler(shopify.disconnect));

module.exports = router;
