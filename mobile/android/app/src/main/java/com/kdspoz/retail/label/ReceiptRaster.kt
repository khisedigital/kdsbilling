package com.kdspoz.retail.label

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import java.text.BreakIterator
import java.util.Locale

/**
 * Thermal printers have no Marathi code page. ASCII lines stay as text.
 * A line that contains Devanagari is drawn with the system font and sent as a raster.
 */
object ReceiptRaster {
  private val DEVANAGARI = Regex("[\\u0900-\\u097F]")
  private val AMOUNT_TAIL = Regex("""^(.*\S)\s+(\d+(?:\.\d+)?\s+\d+\.\d{2}\s+\d+\.\d{2})\s*$""")

  fun encode(plain: String, charsPerLine: Int): ByteArray {
    val cols = charsPerLine.coerceIn(16, 96)
    val (leftDots, widthDots) = printArea(cols)
    val out = ArrayList<Int>()
    out.addAll(listOf(0x1B, 0x40))
    out.addAll(listOf(0x1B, 0x4D, 0x00))
    out.addAll(listOf(0x1B, 0x32))
    out.addAll(listOf(0x1B, 0x45, 0x00, 0x1D, 0x21, 0x00, 0x1B, 0x21, 0x00))
    out.addAll(listOf(0x1B, 0x61, 0x00))
    out.addAll(listOf(0x1D, 0x4C, leftDots and 0xFF, (leftDots shr 8) and 0xFF))
    out.addAll(listOf(0x1D, 0x57, widthDots and 0xFF, (widthDots shr 8) and 0xFF))
    if (DEVANAGARI.containsMatchIn(plain)) {
      // Leave UTF-8 / Chinese mode so the image is not printed as ???.
      out.addAll(listOf(0x1C, 0x2E, 0x1B, 0x74, 0x00))
    }

    for (line in plain.split('\n')) {
      if (!DEVANAGARI.containsMatchIn(line)) {
        for (ch in line) {
          val code = ch.code
          if (code in 0x20..0x7E) out.add(code)
        }
        out.add(0x0A)
      } else {
        appendBitImage(out, renderLine(line, widthDots))
      }
    }

    if (out.isEmpty() || out.last() != 0x0A) out.add(0x0A)
    repeat(6) { out.add(0x0A) }
    out.addAll(listOf(0x1D, 0x56, 0x01))
    return ByteArray(out.size) { index -> out[index].toByte() }
  }

  private fun printArea(cols: Int): Pair<Int, Int> {
    val paper = if (cols <= 32) 384 else 576
    val content = cols * 12
    if (cols <= 32) {
      val left = 24
      val width = minOf(content, paper - left) and 1.inv()
      return left to width
    }
    val leftover = maxOf(0, paper - content)
    var left = (leftover / 2) and 1.inv()
    var right = leftover - left
    if (right - left > 1) {
      left += 2
      right = leftover - left
    }
    val width = maxOf(0, paper - left - right) and 1.inv()
    return left to width
  }

  private fun renderLine(text: String, width: Int): Bitmap {
    val fontSize = 22f
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      textSize = fontSize
      typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
      isSubpixelText = false
    }
    val digitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      textSize = fontSize
      typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }

    val trimmed = text.trim()
    val lead = text.length - text.trimStart().length
    val trail = text.length - text.trimEnd().length
    val centered = trimmed.isNotEmpty() && trimmed != text && lead >= 1 && trail >= 1 && kotlin.math.abs(lead - trail) <= 2
    val amount = if (centered) null else AMOUNT_TAIL.find(text)
    val name = when {
      centered -> trimmed
      amount != null -> amount.groupValues[1].trim()
      else -> trimmed.ifEmpty { text }
    }
    val tail = amount?.groupValues?.getOrNull(2)?.trim().orEmpty()
    val tailWidth = if (tail.isEmpty()) 0f else digitPaint.measureText(tail) + 8f
    val nameMax = (width - tailWidth - 4f).coerceAtLeast(40f)
    val rows = wrapByPixels(textPaint, name, if (centered) width - 8f else nameMax)

    val metrics = textPaint.fontMetrics
    val rowH = kotlin.math.ceil((metrics.descent - metrics.ascent + 6f).toDouble()).toInt().coerceAtLeast(1)
    val height = rowH * rows.size
    val bitmap = Bitmap.createBitmap(width.coerceAtLeast(8), height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.WHITE)

    rows.forEachIndexed { index, row ->
      val baseline = -metrics.ascent + 2f + index * rowH
      if (centered) {
        textPaint.textAlign = Paint.Align.CENTER
        canvas.drawText(row, width / 2f, baseline, textPaint)
      } else {
        textPaint.textAlign = Paint.Align.LEFT
        canvas.drawText(row, 2f, baseline, textPaint)
        if (tail.isNotEmpty() && index == 0) {
          digitPaint.textAlign = Paint.Align.RIGHT
          canvas.drawText(tail, width - 2f, baseline, digitPaint)
        }
      }
    }
    return solidify(bitmap)
  }

  private fun wrapByPixels(paint: Paint, text: String, maxWidth: Float): List<String> {
    if (text.isEmpty()) return listOf("")
    if (paint.measureText(text) <= maxWidth) return listOf(text)
    val breaks = BreakIterator.getCharacterInstance(Locale.forLanguageTag("mr"))
    breaks.setText(text)
    val lines = ArrayList<String>()
    var current = ""
    var end = breaks.first()
    while (end != BreakIterator.DONE) {
      val next = breaks.next()
      if (next == BreakIterator.DONE) break
      val piece = text.substring(end, next)
      val candidate = current + piece
      if (current.isEmpty() || paint.measureText(candidate) <= maxWidth) {
        current = candidate
      } else {
        lines.add(current)
        current = piece
      }
      end = next
    }
    if (current.isNotEmpty()) lines.add(current)
    return if (lines.isEmpty()) listOf(text) else lines
  }

  private fun solidify(source: Bitmap): Bitmap {
    val pixels = IntArray(source.width * source.height)
    source.getPixels(pixels, 0, source.width, 0, 0, source.width, source.height)
    for (i in pixels.indices) {
      val color = pixels[i]
      val lum = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000
      pixels[i] = if (lum < 170) Color.BLACK else Color.WHITE
    }
    source.setPixels(pixels, 0, source.width, 0, 0, source.width, source.height)
    return source
  }

  /** ESC * 24-dot. GS v 0 is ignored on many heads and the bytes print as ???. */
  private fun appendBitImage(out: ArrayList<Int>, bitmap: Bitmap) {
    val width = bitmap.width
    val height = bitmap.height
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    fun black(x: Int, y: Int): Boolean {
      if (x !in 0 until width || y !in 0 until height) return false
      val color = pixels[y * width + x]
      val lum = (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000
      return lum < 170
    }
    out.addAll(listOf(0x1B, 0x33, 24))
    var band = 0
    while (band < height) {
      out.addAll(listOf(0x1B, 0x2A, 33, width and 0xFF, (width shr 8) and 0xFF))
      for (x in 0 until width) {
        for (k in 0 until 3) {
          var slice = 0
          for (b in 0 until 8) {
            if (black(x, band + k * 8 + b)) slice = slice or (0x80 shr b)
          }
          out.add(slice)
        }
      }
      out.add(0x0A)
      band += 24
    }
    out.addAll(listOf(0x1B, 0x32))
    if (!bitmap.isRecycled) bitmap.recycle()
  }
}
