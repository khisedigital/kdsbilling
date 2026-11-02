# Billing POS — Production Deployment

## Quick deploy (VPS)

```bash
# 1. On your server — clone and configure
git clone <your-repo> /var/www/billing-poz
cd /var/www/billing-poz
cp api/.env.production.example api/.env
nano api/.env   # DB, JWT secrets, PLATFORM_ADMIN_PASSWORD, CORS, UPLOAD_PATH

# 2. MySQL — create billing_master + billing_app user (see section 2 below)

# 3. Run automated deploy
chmod +x deploy/deploy-api.sh
./deploy/deploy-api.sh

# 4. Nginx + SSL
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/billing-api
# Edit server_name to your domain, then:
sudo ln -sf /etc/nginx/sites-available/billing-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com

# 5. Verify
curl https://khisedigital.info/kdspozr/health
# Admin panel: https://khisedigital.info/kdspozr/admin
```

**Preflight only (check .env before deploy):**

```bash
cd api && npm run preflight:production
```

**Mobile release APK:**

```bash
# PRODUCTION_API_URL is set in mobile/src/config/env.ts
./deploy/build-mobile-android.sh
```

---

```
Internet → Nginx (SSL) → Node.js API (PM2) on :3008 → MySQL
Mobile App → https://khisedigital.info/kdspozr/api/v1
Admin → https://khisedigital.info/kdspozr/admin
```

Set in `api/.env` for this host (Nginx strips `/kdspozr` like `/payroll`):

```
PORT=3008
PUBLIC_BASE_PATH=/kdspozr
CORS_ORIGINS=https://khisedigital.info
TRUST_PROXY=1
```

Nginx location example: `deploy/nginx-kdspozr.conf.example`
## 1. Server Requirements

- Ubuntu 22.04+ or similar Linux VPS
- Node.js 20 LTS
- MySQL 8.0
- Nginx
- PM2 (`npm install -g pm2`)
- 2GB+ RAM recommended

## 2. MySQL Setup

```bash
sudo mysql -u root -p

CREATE DATABASE billing_master CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'billing_app'@'localhost' IDENTIFIED BY 'strong-password';
GRANT ALL PRIVILEGES ON billing_master.* TO 'billing_app'@'localhost';
GRANT ALL PRIVILEGES ON `billing_tenant_%`.* TO 'billing_app'@'localhost';
GRANT CREATE ON *.* TO 'billing_app'@'localhost';
FLUSH PRIVILEGES;
```

## 3. Deploy API

```bash
# Clone repo on server
git clone <your-repo> /var/www/billing-poz
cd /var/www/billing-poz/api
npm install --production=false

# Configure environment
cd ..
cp api/.env.production.example api/.env
nano api/.env   # set DB, JWT secrets, CORS

# Create upload directory
mkdir -p /var/www/billing-poz/uploads
chmod 755 /var/www/billing-poz/uploads

# Run migrations
cd api
npm run setup:master-db
npm run migrate:master
npm run provision:tenant   # first demo tenant

# Start with PM2 (from repo root)
cd ..
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 4. Nginx + SSL

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/billing-api
sudo ln -s /etc/nginx/sites-available/billing-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL with Let's Encrypt
sudo certbot --nginx -d api.yourdomain.com
```

Update `server_name` and upstream in the nginx config before enabling.

## 5. Security Checklist

- [ ] Change `JWT_SECRET` and `JWT_REFRESH_SECRET` (64+ random chars)
- [ ] Change `PLATFORM_ADMIN_PASSWORD`
- [ ] Set strong MySQL password
- [ ] `CORS_ORIGINS` — only your app domains
- [ ] `TRUST_PROXY=1` when behind nginx
- [ ] Firewall: open 80, 443 only (not 3000 publicly)
- [ ] MySQL bind to localhost only
- [ ] Regular `mysqldump` backups per tenant

## 6. Provision New Shop (Production)

```bash
cd api
npm run provision:tenant -- \
  --name "Mumbai Kirana" \
  --slug mumbai-kirana \
  --owner-email owner@shop.com \
  --owner-password 'SecurePass@123'
```

Or via platform API:

```bash
curl -X POST https://api.yourdomain.com/api/v1/platform/tenants \
  -H "Content-Type: application/json" \
  -H "x-platform-key: YOUR_PLATFORM_KEY" \
  -d '{"name":"Shop Name","slug":"shop-slug","ownerName":"Owner","ownerEmail":"owner@shop.com","ownerPassword":"SecurePass@123"}'
```

## 7. Mobile App (Production Build)

### Configure API URL

Edit `mobile/src/config/env.ts` — set `PRODUCTION_API_URL`:

```typescript
export const PRODUCTION_API_URL = 'https://khisedigital.info/kdspozr/api/v1';
```

Or set custom URL in app: **Dashboard → Printer Settings → Server URL** (stored on device).

### Android Release APK

```bash
cd mobile/android
./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

Sign with keystore for Play Store — see [React Native signed APK docs](https://reactnative.dev/docs/signed-apk-android).

### iOS Release

```bash
cd mobile/ios
pod install
# Open BillingPOS.xcworkspace in Xcode → Archive → Distribute
```

## 8. Bluetooth Printer Setup (Shop Device)

1. Pair thermal printer in Android Bluetooth settings
2. Open app → **Printer Settings**
3. Tap **Scan Bluetooth** → select printer
4. Choose paper size (58mm / 80mm)
5. Tap **Test Print**

## 9. Network Printer Setup

1. Connect printer to shop LAN (get IP e.g. `192.168.1.50`)
2. App → Printer Settings → Network → enter `192.168.1.50:9100`
3. Or register via API `POST /api/v1/printers` with `printerType: network`

## 10. Monitoring

```bash
pm2 status
pm2 logs billing-api
curl https://api.yourdomain.com/health
```

## 11. Tenant Migration (Upgrade)

```bash
cd api
TENANT_DB_NAME=billing_tenant_shop_slug npm run migrate:tenant
TENANT_DB_NAME=billing_tenant_shop_slug npm run seed:tenant
cd ..
pm2 restart billing-api
```

## 12. Backup Script Example

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
mysqldump -u billing_app -p billing_master > /backups/master_$DATE.sql
for db in $(mysql -u billing_app -p -e "SHOW DATABASES LIKE 'billing_tenant_%'" -s); do
  mysqldump -u billing_app -p $db > /backups/${db}_$DATE.sql
done
```
