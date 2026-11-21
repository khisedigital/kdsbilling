'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert');

const errorHandler = require('../src/middleware/errorHandler');
const AppError = require('../src/utils/AppError');

function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

describe('errorHandler middleware', () => {
  const originalEnv = process.env.NODE_ENV;

  it('handles AppError with exact status and code', () => {
    const err = new AppError('Invalid credentials', 401, 'AUTH_FAILED');
    const res = createMockRes();
    errorHandler(err, {}, res, () => {});

    assert.strictEqual(res.statusCode, 401);
    assert.deepStrictEqual(res.body, {
      success: false,
      error: { code: 'AUTH_FAILED', message: 'Invalid credentials' },
    });
  });

  it('handles SequelizeUniqueConstraintError for duplicate SKU and Barcode', () => {
    const errSku = {
      name: 'SequelizeUniqueConstraintError',
      errors: [{ path: 'sku', value: 'SHIRT-RED-L' }],
    };
    const res = createMockRes();
    errorHandler(errSku, {}, res, () => {});

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.error.code, 'DUPLICATE_ENTRY');
    assert.strictEqual(res.body.error.message, 'SKU SHIRT-RED-L is already used');
  });

  describe('in production environment', () => {
    it('masks raw SequelizeDatabaseError with generic message', () => {
      process.env.NODE_ENV = 'production';
      try {
        const err = new Error('SELECT * FROM secret_table WHERE invalid_syntax -- column "password_hash" does not exist');
        err.name = 'SequelizeDatabaseError';
        const res = createMockRes();
        errorHandler(err, {}, res, () => {});

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.body.error.code, 'DB_ERROR');
        assert.strictEqual(res.body.error.message, 'A database error occurred');
        assert.strictEqual(JSON.stringify(res.body).includes('secret_table'), false);
        assert.strictEqual(JSON.stringify(res.body).includes('password_hash'), false);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('masks raw internal server errors with generic message', () => {
      process.env.NODE_ENV = 'production';
      try {
        const err = new Error('Sensitive stack trace: failed at /secret/keys/jwt.pem');
        const res = createMockRes();
        errorHandler(err, {}, res, () => {});

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.body.error.code, 'INTERNAL_ERROR');
        assert.strictEqual(res.body.error.message, 'Something went wrong');
        assert.strictEqual(JSON.stringify(res.body).includes('jwt.pem'), false);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('in development/test environment', () => {
    it('returns raw error message for developers to debug', () => {
      process.env.NODE_ENV = 'development';
      try {
        const rawSql = 'SELECT * FROM products WHERE syntax error';
        const err = new Error(rawSql);
        err.name = 'SequelizeDatabaseError';
        const res = createMockRes();
        errorHandler(err, {}, res, () => {});

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.body.error.code, 'DB_ERROR');
        assert.strictEqual(res.body.error.message, rawSql);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
