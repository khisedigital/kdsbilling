/**
 * QR Code generation helper for bill printing
 * Supports generating QR codes for:
 * - UPI payment links with dynamic amounts
 * - Bill references
 * - Direct URL-based QR generation via API
 */

export interface QrCodeOptions {
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
  format?: 'svg' | 'png' | 'base64';
}

/**
 * Generate a data URL for QR code using external QR code API
 * This avoids needing a local QR library and allows server-side generation
 * @param data - The data to encode (e.g., UPI string, URL)
 * @param size - QR code size in pixels (default 200)
 * @returns Data URL that can be embedded in HTML/print
 */
export function generateQrCodeUrl(data: string, size = 200): string {
  if (!data) return '';
  
  const encoded = encodeURIComponent(data);
  // Using qr-server.com API which is free and doesn't require additional dependencies
  // Format: https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=YOUR_DATA
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`;
}

/**
 * Generate UPI payment QR code for dynamic amounts
 * UPI URL format: upi://pay?pa=UPI_ID&pn=PAYEE_NAME&am=AMOUNT&tn=TRANSACTION_NOTE
 * @param upiId - UPI ID (e.g., merchant@bank)
 * @param merchantName - Name of the merchant
 * @param amount - Amount to be paid
 * @param note - Transaction note (bill number, etc.)
 * @param size - QR code size
 * @returns QR code image URL
 */
export function generatePaymentQrCode(
  upiId: string,
  merchantName: string,
  amount: number,
  note: string,
  size = 200,
): string {
  if (!upiId || !merchantName) return '';
  
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${amount}&tn=${encodeURIComponent(note)}`;
  return generateQrCodeUrl(upiUrl, size);
}

/**
 * Generate bill QR code (could link to bill details page or unique bill identifier)
 * @param billId - Unique bill identifier
 * @param baseUrl - Base URL of the application
 * @param size - QR code size
 * @returns QR code image URL
 */
export function generateBillQrCode(
  billId: string,
  baseUrl: string,
  size = 200,
): string {
  if (!billId || !baseUrl) return '';
  
  const billUrl = `${baseUrl}/bill/${billId}`;
  return generateQrCodeUrl(billUrl, size);
}
