# KDSPOZ Retail — App Store (iPhone) submission

Everything needed to fill in App Store Connect for the iPhone app.

| File | Use it for |
| --- | --- |
| `listing.md` | App information, version page text, URLs |
| `review-notes.md` | App Review Information (demo account, notes) |
| `app-privacy.md` | App Privacy questionnaire answers |
| `checklist.md` | Step-by-step submission checklist |
| `app-icon-1024.png` | App Store icon (same file as the Xcode AppIcon; uploaded automatically with the build) |
| `screenshots/iphone-6.9in-1320x2868/` | 6.9" iPhone screenshots — upload these |
| `screenshots/iphone-6.5in-1284x2778/` | 6.5" iPhone screenshots — optional backup set |
| `screenshots/iphone-6.3in-1206x2622/` | 6.1" / 6.3" iPhone screenshots — optional |
| `artwork/` | Product-page header and search-result artwork: 5244 × 2950 (16:9), 3840 × 2560 and 1920 × 1280 (3:2). Same design as the website share image `website/assets/og-image.jpg` |

## Image sizes required by the App Store (iPhone-only app)

| Asset | Required? | Size (px) | Rules |
| --- | --- | --- | --- |
| App icon | Yes | 1024 × 1024 | PNG, RGB, no transparency, square corners (Apple rounds them). Comes from the build's asset catalog. |
| 6.9" iPhone screenshots | Yes | 1320 × 2868 (also accepted: 1290 × 2796, 1260 × 2736) | 1–10 images, PNG or JPEG, RGB, no transparency, portrait or landscape |
| 6.5" iPhone screenshots | Only if no 6.9" set | 1284 × 2778 or 1242 × 2688 | Same rules |
| 6.1" / 6.3" iPhone screenshots | No | 1206 × 2622 or 1179 × 2556 | Scaled from the 6.9" set if left empty |
| Smaller iPhones (5.5"…) | No | — | App Store Connect scales the 6.9" set down automatically |
| iPad screenshots | No | — | Not needed; the app is iPhone only |
| App preview video | No | 886 × 1920 (6.9"), 15–30 s | Optional |

Upload order in App Store Connect follows the file numbers: billing, payment, dashboard, products, stock, reports, Shopify. The first three appear in search results.

The screenshots are real app screens from the demo shop, framed with an iPhone status bar and a caption.

## App facts

- App name: **KDSPOZ Retail**
- Bundle ID: `com.khisedigital.kdspozretails`
- Team ID: `PZSN5H5579`
- Version 1.2.0, build 1
- Devices: iPhone only
- Xcode archive: `~/Library/Developer/Xcode/Archives/2026-10-13/KDSPOZRetail 1.2.0 (1) kdspozretails.xcarchive`
- Release file: `build/KDSPOZRetail-1.2.0-1.ipa` (signed for App Store with Apple Distribution, team PZSN5H5579)

## Public URLs (served from `website/`)

- Privacy Policy: https://kdspoz.khisedigital.in/privacy-policy.html (`website/privacy-policy.html`)
- Support: https://kdspoz.khisedigital.in/support.html (`website/support.html`)
- Marketing: https://kdspoz.khisedigital.in/ (`website/index.html`)

Upload the updated `website/` folder to the server before submitting; App Review opens these links.
