package com.kdspoz.retail.label

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import java.text.BreakIterator
import java.util.Locale

/**
 * Render at the 58 mm head width (384 dots @ 203 dpi), not 50 mm × 8 = 400.
 * Downscaling 400→384 softens glyph edges on thermal paper.
 * Height must match the physical roll (25 or 28 mm) or GS FF skips a sticker.
 */
private const val LABEL_WIDTH_PX = 384
private const val LABEL_WIDTH_MM = 50

private fun labelHeightPx(heightMm: Int): Int {
  val h = when (heightMm) {
    25 -> 25
    30 -> 30
    else -> 28
  }
  return LABEL_WIDTH_PX * h / LABEL_WIDTH_MM
}

private val TITLE_FONT: Typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
private val DEVANAGARI = Regex("[\\u0900-\\u097F]")
/** Readable monospace for the human-readable barcode under the bars. */
private val DIGIT_FONT: Typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)

data class LabelContent(
  val shopName: String,
  val productName: String,
  val detail: String,
  val barcode: String,
  val mrp: String,
  val price: String,
)

/**
 *  [           Shop name (large)              ]
 *  [ Product name left    |  qty  price right ]
 *  --------------------------------------------
 *  [              BARCODE                     ]
 *  [              barcode digits              ]
 */
fun renderLabelBitmap(content: LabelContent, heightMm: Int = 28): Bitmap {
  val width = LABEL_WIDTH_PX
  val height = labelHeightPx(heightMm)
  /**
   * One sticker frame — shop / product / divider / barcode / digits / white gap margin.
   * Never let bars or digits spill into the gap (that looks like a "broken" barcode).
   */
  val padX = maxOf(6, width / 32)
  // ~1.2 mm top clearance — small padY was clipping the shop title on thermal heads.
  val padY = maxOf(10, height / 22)
  val lineGap = 3f
  val preferredFooter = 17f
  val bottomClear = 18f
  val digitGap = 3f
  val footerReserve = preferredFooter + digitGap + bottomClear

  val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  canvas.drawColor(Color.WHITE)

  val paint = Paint().apply {
    color = Color.BLACK
    isAntiAlias = false
    isDither = false
    isFilterBitmap = false
    style = Paint.Style.FILL
    typeface = TITLE_FONT
    isFakeBoldText = false
    isSubpixelText = false
    isLinearText = false
    hinting = Paint.HINTING_ON
  }

  var y = padY.toFloat()

  val shopSource = content.shopName.ifBlank { "Shop" }.replace(Regex("[A-Za-z]+")) { it.value.uppercase() }
  val productSource = content.productName.ifBlank { "Product" }
  val indic = DEVANAGARI.containsMatchIn(shopSource) || DEVANAGARI.containsMatchIn(productSource) ||
    DEVANAGARI.containsMatchIn(content.detail)
  val shopSize = if (indic) 24f else 22f
  paint.textSize = shopSize
  paint.textAlign = Paint.Align.CENTER
  paint.isAntiAlias = indic
  // FontMetrics: draw baseline so the full ascent sits below padY (not clipped at top).
  val shop = ellipsize(paint, shopSource, shopSize, (width - padX * 2).toFloat())
  val fm = paint.fontMetrics
  y += -fm.ascent
  canvas.drawText(shop, (width / 2).toFloat(), y, paint)
  y += fm.descent + lineGap

  // ~2.5–3 mm. Smaller strokes heat into a dark blur on 203 dpi heads.
  val productSize = if (indic) 20f else 18f
  val qtySize = if (indic) 18f else 17f
  val priceSize = if (indic) 22f else 20f

  val qtyText = content.detail.trim()
  val priceText = content.price.ifBlank { content.mrp }.trim()
  paint.textSize = qtySize
  val qtyW = if (qtyText.isBlank()) 0f else paint.measureText(qtyText)
  paint.textSize = priceSize
  val priceW = if (priceText.isBlank()) 0f else paint.measureText(priceText)
  val between = if (qtyText.isNotBlank() && priceText.isNotBlank()) 10f else 0f
  val rightWidth = qtyW + between + priceW
  val gap = 8f
  val leftMax = (width - padX * 2 - rightWidth - gap).coerceAtLeast(width * 0.28f)

  paint.textSize = productSize
  val productText = ellipsize(
    paint,
    content.productName.ifBlank { "Product" },
    productSize,
    leftMax,
  )

  y += maxOf(productSize, qtySize, priceSize)
  paint.textAlign = Paint.Align.LEFT
  paint.textSize = productSize
  paint.isAntiAlias = DEVANAGARI.containsMatchIn(productText)
  canvas.drawText(productText, padX.toFloat(), y, paint)

  // Right: quantity then selling price (e.g. "500 g  ₹70").
  if (qtyText.isNotBlank() || priceText.isNotBlank()) {
    paint.textAlign = Paint.Align.RIGHT
    var x = (width - padX).toFloat()
    if (priceText.isNotBlank()) {
      paint.textSize = priceSize
      paint.isAntiAlias = DEVANAGARI.containsMatchIn(priceText)
      canvas.drawText(priceText, x, y, paint)
      x -= priceW + between
    }
    if (qtyText.isNotBlank()) {
      paint.textSize = qtySize
      paint.isAntiAlias = DEVANAGARI.containsMatchIn(qtyText)
      canvas.drawText(qtyText, x, y, paint)
    }
  }
  y += lineGap

  paint.strokeWidth = 1f
  paint.style = Paint.Style.STROKE
  canvas.drawLine(padX.toFloat(), y, (width - padX).toFloat(), y, paint)
  paint.style = Paint.Style.FILL
  y += 3f

  val barTop = y.toInt().coerceAtMost((height - footerReserve - 24f).toInt().coerceAtLeast(0))
  val barBottom = (height - footerReserve).toInt().coerceAtLeast(barTop + 24)
  val barH = (barBottom - barTop).coerceAtLeast(22)

  val code = content.barcode.ifBlank { "2000000000008" }.replace("\\s+".toRegex(), "")
  drawBarcode(
    canvas,
    code,
    padX.toFloat(),
    barTop.toFloat(),
    (width - padX * 2).toFloat(),
    barH.toFloat(),
  )

  val digitTop = barTop + barH + digitGap.toInt()
  paint.color = Color.WHITE
  canvas.drawRect(0f, digitTop.toFloat(), width.toFloat(), height.toFloat(), paint)
  paint.color = Color.BLACK
  paint.typeface = DIGIT_FONT
  paint.isFakeBoldText = false
  paint.isAntiAlias = false
  paint.textAlign = Paint.Align.LEFT
  val maxDigitWidth = (width - padX * 2).toFloat()
  var digitSize = preferredFooter
  paint.textSize = digitSize
  val digitGapPx = maxOf(2f, digitSize / 6f)
  fun spacedWidth(size: Float): Float {
    paint.textSize = size
    var total = 0f
    for (i in code.indices) {
      total += paint.measureText(code, i, i + 1)
      if (i < code.lastIndex) total += digitGapPx
    }
    return total
  }
  while (digitSize >= 13f && spacedWidth(digitSize) > maxDigitWidth) {
    digitSize -= 1f
  }
  paint.textSize = digitSize
  val digitY = (digitTop + digitSize).coerceAtMost(height - bottomClear)
  var digitX = (width - spacedWidth(digitSize)) / 2f
  for (i in code.indices) {
    val ch = code.substring(i, i + 1)
    canvas.drawText(ch, digitX, digitY, paint)
    digitX += paint.measureText(ch) + digitGapPx
  }

  // Pure white gap margin — no ink in the sensor/cutter band.
  paint.color = Color.WHITE
  canvas.drawRect(0f, height - bottomClear, width.toFloat(), height.toFloat(), paint)

  // Always. Gray edges (even with anti-alias off) become a dark smear after dithering.
  solidify(bitmap)
  return bitmap
}

/** Pure black or white. A high cut (168) kept the gray halo and filled letter gaps. */
private fun solidify(bitmap: Bitmap) {
  val pixels = IntArray(bitmap.width * bitmap.height)
  bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
  for (i in pixels.indices) {
    val color = pixels[i]
    val lum = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000
    pixels[i] = if (lum < 128) Color.BLACK else Color.WHITE
  }
  bitmap.setPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
}

private fun ellipsizeDigits(paint: Paint, text: String, maxWidth: Float): String {
  if (paint.measureText(text) <= maxWidth) return text
  val ellipsis = ".."
  var end = text.length
  while (end > 0 && paint.measureText(text.substring(0, end) + ellipsis) > maxWidth) {
    end -= 1
  }
  return if (end <= 0) ellipsis else text.substring(0, end) + ellipsis
}

private fun ellipsize(
  paint: Paint,
  text: String,
  size: Float,
  maxWidth: Float,
): String {
  if (maxWidth <= 0f) return ""
  paint.textSize = size
  paint.typeface = TITLE_FONT
  paint.isFakeBoldText = false
  if (paint.measureText(text) <= maxWidth) return text
  val ellipsis = ".."
  val breaks = BreakIterator.getCharacterInstance(Locale.forLanguageTag("mr"))
  breaks.setText(text)
  var lastFit = 0
  var end = breaks.first()
  while (end != BreakIterator.DONE) {
    val next = breaks.next()
    if (next == BreakIterator.DONE) break
    if (paint.measureText(text.substring(0, next) + ellipsis) > maxWidth) break
    lastFit = next
    end = next
  }
  return if (lastFit <= 0) ellipsis else text.substring(0, lastFit) + ellipsis
}

private fun drawBarcode(canvas: Canvas, barcode: String, x: Float, y: Float, width: Float, height: Float) {
  val modules = try {
    BarcodeEncoder.encode(barcode)
  } catch (_: Exception) {
    "1011001101011001101001101101001"
  }
  val quiet = BarcodeEncoder.QUIET_ZONE_MODULES
  val total = modules.length + quiet * 2
  val left = x.toInt()
  val span = width.toInt().coerceAtLeast(total)
  val top = y.toInt()
  val bottom = (y + height).toInt().coerceAtLeast(top + 1)
  val paint = Paint().apply {
    color = Color.BLACK
    style = Paint.Style.FILL
    isAntiAlias = false
  }
  // Integer columns so a 1-module white gap is never rounded away.
  fun col(index: Int) = left + (index * span) / total
  var i = 0
  while (i < modules.length) {
    if (modules[i] != '1') {
      i += 1
      continue
    }
    var run = 1
    while (i + run < modules.length && modules[i + run] == '1') run += 1
    val start = col(quiet + i)
    val end = col(quiet + i + run)
    if (end > start) {
      canvas.drawRect(start.toFloat(), top.toFloat(), end.toFloat(), bottom.toFloat(), paint)
    }
    i += run
  }
}
