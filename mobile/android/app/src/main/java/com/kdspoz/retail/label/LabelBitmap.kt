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
  val h = if (heightMm == 25) 25 else 28
  return LABEL_WIDTH_PX * h / LABEL_WIDTH_MM
}

private val TITLE_FONT: Typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
private val DEVANAGARI = Regex("[\\u0900-\\u097F]")
/** Readable monospace for the human-readable barcode under the bars. */
private val DIGIT_FONT: Typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)

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
  val padX = maxOf(6, width / 32)
  val padY = maxOf(4, height / 24)

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
  val shop = ellipsize(paint, shopSource, shopSize, (width - padX * 2).toFloat())
  y += shopSize
  canvas.drawText(shop, (width / 2).toFloat(), y, paint)
  y += if (indic) 8f else 5f

  val productSize = if (indic) 20f else 18f
  val priceSize = if (indic) 20f else 18f
  paint.textSize = priceSize

  val qtyText = content.detail.trim()
  val priceText = content.price.ifBlank { content.mrp }.trim()
  val rightPart = listOf(qtyText, priceText).filter { it.isNotBlank() }.joinToString("  ")
  val rightWidth = if (rightPart.isBlank()) 0f else paint.measureText(rightPart)
  val gap = 10f
  val leftMax = (width - padX * 2 - rightWidth - gap).coerceAtLeast(width * 0.32f)

  paint.textSize = productSize
  val productText = ellipsize(
    paint,
    content.productName.ifBlank { "Product" },
    productSize,
    leftMax,
  )

  y += productSize.coerceAtLeast(priceSize)
  paint.textAlign = Paint.Align.LEFT
  paint.textSize = productSize
  paint.isAntiAlias = DEVANAGARI.containsMatchIn(productText)
  canvas.drawText(productText, padX.toFloat(), y, paint)

  if (rightPart.isNotBlank()) {
    paint.textAlign = Paint.Align.RIGHT
    paint.textSize = priceSize
    paint.isAntiAlias = DEVANAGARI.containsMatchIn(rightPart)
    canvas.drawText(rightPart, (width - padX).toFloat(), y, paint)
  }
  y += if (indic) 8f else 5f

  paint.strokeWidth = 1f
  paint.style = Paint.Style.STROKE
  canvas.drawLine(padX.toFloat(), y, (width - padX).toFloat(), y, paint)
  paint.style = Paint.Style.FILL
  y += 5f

  // Bars fill the sticker down to the digit line so the print uses the selected label height.
  val preferredFooter = 18f
  val footerReserve = preferredFooter + padY + 4f
  val barTop = y.toInt()
  val barBottom = (height - footerReserve).toInt().coerceAtLeast(barTop + 24)

  val code = content.barcode.ifBlank { "2000000000008" }.replace("\\s+".toRegex(), "")
  drawBarcode(
    canvas,
    code,
    padX.toFloat(),
    barTop.toFloat(),
    (width - padX * 2).toFloat(),
    (barBottom - barTop).toFloat(),
  )

  // White strip under bars, then solid black digits (fit long Code 128 values).
  val digitTop = barBottom + 2
  paint.color = Color.WHITE
  canvas.drawRect(0f, digitTop.toFloat(), width.toFloat(), height.toFloat(), paint)
  paint.color = Color.BLACK
  paint.typeface = DIGIT_FONT
  paint.isFakeBoldText = false
  paint.isAntiAlias = false
  paint.textAlign = Paint.Align.CENTER
  val maxDigitWidth = (width - padX * 2).toFloat()
  var digitSize = preferredFooter
  paint.textSize = digitSize
  while (digitSize >= 11f && paint.measureText(code) > maxDigitWidth) {
    digitSize -= 1f
    paint.textSize = digitSize
  }
  val digitText =
    if (paint.measureText(code) <= maxDigitWidth) code
    else ellipsizeDigits(paint, code, maxDigitWidth)
  // Baseline inside the footer — not clipped off the sticker edge.
  val digitY = (digitTop + digitSize).coerceAtMost((height - 2).toFloat())
  canvas.drawText(digitText, (width / 2).toFloat(), digitY, paint)

  if (indic) solidifyDevanagari(bitmap)
  return bitmap
}

/** Turn gray anti-aliased Marathi strokes into solid black so the thermal head prints them. */
private fun solidifyDevanagari(bitmap: Bitmap) {
  val pixels = IntArray(bitmap.width * bitmap.height)
  bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
  for (i in pixels.indices) {
    val color = pixels[i]
    val lum = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000
    pixels[i] = if (lum < 170) Color.BLACK else Color.WHITE
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
  val module = width / total.toFloat()
  val x0 = x
  val top = y.toInt()
  val bottom = (y + height).toInt().coerceAtLeast(top + 1)
  val paint = Paint().apply {
    color = Color.BLACK
    style = Paint.Style.FILL
    isAntiAlias = false
  }
  var i = 0
  while (i < modules.length) {
    if (modules[i] != '1') {
      i += 1
      continue
    }
    var run = 1
    while (i + run < modules.length && modules[i + run] == '1') run += 1
    val start = x0 + (quiet + i) * module
    val end = x0 + (quiet + i + run) * module
    if (end > start) {
      canvas.drawRect(start, top.toFloat(), end, bottom.toFloat(), paint)
    }
    i += run
  }
}
