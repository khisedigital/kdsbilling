const config = require('../../config');
const { encryptToken, decryptToken, sleep, isValidShopDomain } = require('./shopifyUtils');

const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 6;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MIN_AVAILABLE_POINTS = 200;

class ShopifyAuthError extends Error {
  constructor(message) {
    super(message || 'Shopify authorization is no longer valid. Reconnect the store.');
    this.name = 'ShopifyAuthError';
    this.code = 'SHOPIFY_AUTH';
    this.retryable = false;
  }
}

class ShopifyApiError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'ShopifyApiError';
    this.retryable = retryable;
    this.status = status;
  }
}

function backoffMs(attempt) {
  return Math.min(30000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { status: res.status, body };
}

function tokenFields(body, now = Date.now()) {
  const fields = {
    access_token_enc: encryptToken(body.access_token),
    scopes: body.scope || null,
    access_token_expires_at: body.expires_in ? new Date(now + Number(body.expires_in) * 1000) : null,
  };
  if (body.refresh_token) {
    fields.refresh_token_enc = encryptToken(body.refresh_token);
    fields.refresh_token_expires_at = body.refresh_token_expires_in
      ? new Date(now + Number(body.refresh_token_expires_in) * 1000)
      : null;
  } else {
    fields.refresh_token_enc = null;
    fields.refresh_token_expires_at = null;
  }
  return fields;
}

/** Authorization-code grant; `expiring=1` requests an expiring offline token + refresh token. */
async function exchangeCodeForToken(shop, code) {
  if (!isValidShopDomain(shop)) throw new ShopifyApiError('Invalid shop domain');
  const { status, body } = await postForm(`https://${shop}/admin/oauth/access_token`, {
    client_id: config.shopify.apiKey,
    client_secret: config.shopify.apiSecret,
    code,
    expiring: '1',
  });
  if (status !== 200 || !body?.access_token) {
    throw new ShopifyApiError(
      `Shopify token exchange failed (${status}): ${body?.error_description || body?.error || 'unknown error'}`
    );
  }
  return body;
}

async function requestTokenRefresh(shop, refreshToken) {
  const { status, body } = await postForm(`https://${shop}/admin/oauth/access_token`, {
    client_id: config.shopify.apiKey,
    client_secret: config.shopify.apiSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (status === 200 && body?.access_token) return body;
  if (status === 400 || status === 401) {
    throw new ShopifyAuthError(
      `Shopify refresh token rejected: ${body?.error_description || body?.error || status}. Reconnect the store.`
    );
  }
  throw new ShopifyApiError(`Shopify token refresh failed (${status})`, { retryable: true, status });
}

function needsRefresh(conn) {
  if (!conn.access_token_expires_at) return false;
  return new Date(conn.access_token_expires_at).getTime() - Date.now() < REFRESH_MARGIN_MS;
}

/**
 * Returns a usable access token, rotating it when close to expiry. The refresh runs
 * under a row lock so concurrent workers never spend the same refresh token twice.
 */
async function getAccessToken(db, connectionId, { force = false } = {}) {
  const { ShopifyConnection } = db;
  const current = await ShopifyConnection.findByPk(connectionId);
  if (!current || !current.access_token_enc || current.status === 'disconnected') {
    throw new ShopifyAuthError('Shopify store is not connected');
  }
  if (!force && !needsRefresh(current)) return decryptToken(current.access_token_enc);
  if (!current.refresh_token_enc) {
    if (!force && current.access_token_expires_at && new Date(current.access_token_expires_at) > new Date()) {
      return decryptToken(current.access_token_enc);
    }
    throw new ShopifyAuthError();
  }

  return db.sequelize.transaction(async (transaction) => {
    const locked = await ShopifyConnection.findByPk(connectionId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked?.refresh_token_enc) throw new ShopifyAuthError();
    const rotatedElsewhere = locked.access_token_enc !== current.access_token_enc;
    if (rotatedElsewhere || (!force && !needsRefresh(locked))) {
      return decryptToken(locked.access_token_enc);
    }
    const body = await requestTokenRefresh(locked.shop_domain, decryptToken(locked.refresh_token_enc));
    await locked.update(tokenFields(body), { transaction });
    return body.access_token;
  });
}

function throttleWaitMs(extensions) {
  const cost = extensions?.cost;
  const status = cost?.throttleStatus;
  if (!status) return 2000;
  const needed = (cost.requestedQueryCost || 100) - (status.currentlyAvailable || 0);
  const rate = status.restoreRate || 50;
  return Math.max(1000, Math.ceil((needed / rate) * 1000) + 250);
}

async function graphqlRequest(shop, token, query, variables) {
  const url = `https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables: variables || {} }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = new ShopifyApiError(`Shopify request failed: ${err.message}`, { retryable: true });
      await sleep(backoffMs(attempt));
      continue;
    }

    if (res.status === 401) throw new ShopifyAuthError();
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = parseFloat(res.headers.get('retry-after'));
      lastError = new ShopifyApiError(`Shopify responded ${res.status}`, { retryable: true, status: res.status });
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : backoffMs(attempt));
      continue;
    }
    if (res.status === 402 || res.status === 403 || res.status === 404 || res.status === 423) {
      throw new ShopifyApiError(`Shopify store unavailable (${res.status})`, { status: res.status });
    }

    let body;
    try {
      body = await res.json();
    } catch (_) {
      lastError = new ShopifyApiError('Invalid JSON from Shopify', { retryable: true });
      await sleep(backoffMs(attempt));
      continue;
    }

    const errors = Array.isArray(body.errors) ? body.errors : body.errors ? [body.errors] : [];
    if (errors.some((e) => e?.extensions?.code === 'THROTTLED')) {
      lastError = new ShopifyApiError('Shopify API throttled', { retryable: true });
      await sleep(throttleWaitMs(body.extensions));
      continue;
    }
    if (errors.length) {
      const message = errors.map((e) => e?.message || JSON.stringify(e)).join('; ');
      if (/access denied|access token/i.test(message)) throw new ShopifyAuthError(message);
      throw new ShopifyApiError(`Shopify GraphQL error: ${message}`);
    }

    const available = body.extensions?.cost?.throttleStatus?.currentlyAvailable;
    const restoreRate = body.extensions?.cost?.throttleStatus?.restoreRate || 50;
    if (typeof available === 'number' && available < MIN_AVAILABLE_POINTS) {
      await sleep(Math.ceil(((MIN_AVAILABLE_POINTS - available) / restoreRate) * 1000));
    }
    return body.data;
  }

  throw lastError || new ShopifyApiError('Shopify request failed', { retryable: true });
}

/** GraphQL client bound to one tenant connection; retries once with a forced token refresh on 401. */
function createClient(db, connection) {
  const shop = connection.shop_domain;
  const connectionId = connection.id;

  async function query(gql, variables) {
    const token = await getAccessToken(db, connectionId);
    try {
      return await graphqlRequest(shop, token, gql, variables);
    } catch (err) {
      if (!(err instanceof ShopifyAuthError)) throw err;
      const fresh = await getAccessToken(db, connectionId, { force: true });
      return graphqlRequest(shop, fresh, gql, variables);
    }
  }

  return { shop, query };
}

/** Collects every node of a cursor-paginated connection. `pick(data)` returns the connection object. */
async function paginate(client, gql, variables, pick, onPage) {
  let cursor = null;
  const all = [];
  for (let page = 0; page < 10000; page++) {
    const data = await client.query(gql, { ...variables, cursor });
    const conn = pick(data);
    const nodes = conn?.nodes || [];
    if (onPage) await onPage(nodes);
    else all.push(...nodes);
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return all;
}

function assertNoUserErrors(result, label) {
  const errors = result?.userErrors || [];
  if (errors.length) {
    const message = errors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; ');
    throw new ShopifyApiError(`${label}: ${message}`);
  }
}

module.exports = {
  ShopifyAuthError,
  ShopifyApiError,
  exchangeCodeForToken,
  tokenFields,
  getAccessToken,
  graphqlRequest,
  createClient,
  paginate,
  assertNoUserErrors,
};
