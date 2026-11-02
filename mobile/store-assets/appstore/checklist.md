# Submission checklist

## Before submitting

- [ ] Upload the updated `website/` (privacy-policy.html, support.html, index.html) and check both URLs open:
      https://kdspoz.khisedigital.in/privacy-policy.html and https://kdspoz.khisedigital.in/support.html
- [ ] Deploy the latest API to production (barcode generation endpoint) and restart `billing-api` in PM2
- [ ] Create the demo shop on production and fill in `review-notes.md`
- [x] 6.9" iPhone screenshots (1320 × 2868) in `screenshots/iphone-6.9in-1320x2868/`

## App Store Connect

- [ ] My Apps → + → New App: iOS, name "KDSPOZ Retail", language English (India), bundle ID `com.khisedigital.kdspozretails`, SKU `kdspoz-retail-ios`
- [ ] App Information: subtitle, categories, content rights, age rating (`listing.md`)
- [ ] Pricing and Availability: Free
- [ ] App Privacy: privacy policy URL and answers (`app-privacy.md`)
- [ ] Version 1.2.0: screenshots (drag in the 7 files from `screenshots/iphone-6.9in-1320x2868/` under "iPhone 6.9" Display"), promotional text, description, keywords, support and marketing URLs, What's New, copyright
- [ ] App Review Information: demo login, contact, notes (`review-notes.md`)

## Upload the build

- [ ] Create the app in App Store Connect first (bundle ID `com.khisedigital.kdspozretails`), then upload either way:
      - Transporter app (Mac App Store): drag in `build/KDSPOZRetail-1.2.0-1.ipa` → Deliver, or
      - Xcode → Window → Organizer → "KDSPOZRetail 1.2.0 (1) kdspozretails" → Distribute App → App Store Connect → Upload
- [ ] Wait for processing email, then select the build on the version page
- [ ] Export compliance: answered automatically (`ITSAppUsesNonExemptEncryption = false`)
- [ ] Add for Review → Submit

## Next build

Increase `CURRENT_PROJECT_VERSION` (build number) in Xcode for every new upload; increase `MARKETING_VERSION` for a new release.
