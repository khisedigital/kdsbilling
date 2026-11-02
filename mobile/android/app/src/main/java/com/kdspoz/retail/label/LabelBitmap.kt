package com.kdspoz.retail.label

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/**
 * Render at the 58 mm head width (384 dots @ 203 dpi), not 50 mm × 8 = 400.
 * Downscaling 400→384 softens glyph edges on thermal paper.
 */
private const val LABEL_WIDTH_PX = 384
private const val LABEL_HEIGHT_PX = LABEL_WIDTH_PX * 25 / 50 // 192 — keep 50×25 aspect

private val TITLE_FONT: Typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
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
fun renderLabelBitmap(content: LabelContent): Bitmap {
  val width = LABEL_WIDTH_PX
  val height = LABEL_HEIGHT_PX
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

  val shopSize = 22f
  paint.textSize = shopSize
  paint.textAlign = Paint.Align.CENTER
  val shop = ellipsize(paint, content.shopName.ifBlank { "Shop" }.uppercase(), shopSize, (width - padX * 2).toFloat())
  y += shopSize
  canvas.drawText(shop, (width / 2).toFloat(), y, paint)
  y += 5f

  val productSize = 18f
  val priceSize = 18f
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
  canvas.drawText(productText, padX.toFloat(), y, paint)

  if (rightPart.isNotBlank()) {
    paint.textAlign = Paint.Align.RIGHT
    paint.textSize = priceSize
    canvas.drawText(rightPart, (width - padX).toFloat(), y, paint)
  }
  y += 5f

  paint.strokeWidth = 1f
  paint.style = Paint.Style.STROKE
  canvas.drawLine(padX.toFloat(), y, (width - padX).toFloat(), y, paint)
  paint.style = Paint.Style.FILL
  y += 5f

  // Keep a clear footer so the barcode number is always visible on 50×25 mm.
  val preferredFooter = 18f
  val footerReserve = preferredFooter + padY + 6f
  val barTop = y.toInt()
  val maxBarH = (height * 0.26f).toInt()
  val barBottom = (height - footerReserve).toInt().coerceAtMost(barTop + maxBarH).coerceAtLeast(barTop + 24)

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

  return bitmap
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
  var end = text.length
  while (end > 0 && paint.measureText(text.substring(0, end) + ellipsis) > maxWidth) {
    end -= 1
  }
  return if (end <= 0) ellipsis else text.substring(0, end) + ellipsis
}

private fun drawBarcode(canvas: Canvas, barcode: String, x: Float, y: Float, width: Float, height: Float) {
  val modules = try {
    BarcodeEncoder.encode(barcode)
  } catch (_: Exception) {
    "1011001101011001101001101101001"
  }
  val quiet = BarcodeEncoder.QUIET_ZONE_MODULES
  val total = modules.length + quiet * 2
  val module = (width / total).toInt().coerceAtLeast(2)
  val barLeft = x.toInt() + quiet * module
  val top = y.toInt()
  val bottom = (y + height).toInt().coerceAtLeast(top + 1)
  val paint = Paint().apply {
    color = Color.BLACK
    style = Paint.Style.FILL
    isAntiAlias = false
  }
  var cursor = barLeft
  var i = 0
  while (i < modules.length) {
    if (modules[i] != '1') {
      cursor += module
      i += 1
      continue
    }
    var run = 1
    while (i + run < modules.length && modules[i + run] == '1') run += 1
    canvas.drawRect(
      cursor.toFloat(),
      top.toFloat(),
      (cursor + run * module).toFloat(),
      bottom.toFloat(),
      paint,
    )
    cursor += run * module
    i += run
  }
}
