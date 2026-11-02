const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const shopify = require('../controllers/shopifyController');

/**
 * Public endpoints called by Shopify (no POS JWT). Authenticity is proven by
 * Shopify's HMAC signatures. Mounted before express.json so webhooks keep the raw body.
 */
const router = express.Router();

router.get('/oauth/callback', asyncHandler(shopify.oauthCallback));
router.post('/webhooks', express.raw({ type: '*/*', limit: '5mb' }), asyncHandler(shopify.webhook));

module.exports = router;
