package com.kdspoz.retail.label

/**
 * EAN-13 for valid 13-digit retail codes, Code 128 otherwise.
 * Same rules as the Microlan label demo app.
 */
object BarcodeEncoder {
  const val QUIET_ZONE_MODULES = 10

  private val CODE128_PATTERNS = arrayOf(
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
  )

  private const val START_B = 104
  private const val START_C = 105
  private const val CODE_B = 100
  private const val STOP = 106

  private val EAN_L = arrayOf(
    "0001101", "0011001", "0010011", "0111101", "0100011",
    "0110001", "0101111", "0111011", "0110111", "0001011",
  )
  private val EAN_G = arrayOf(
    "0100111", "0110011", "0011011", "0100001", "0011101",
    "0111001", "0000101", "0010001", "0001001", "0010111",
  )
  private val EAN_R = arrayOf(
    "1110010", "1100110", "1101100", "1000010", "1011100",
    "1001110", "1010000", "1000100", "1001000", "1110100",
  )
  private val EAN_PARITY = arrayOf(
    "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
    "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
  )

  fun isValidEan13(value: String): Boolean {
    if (!value.matches(Regex("\\d{13}"))) return false
    return ean13CheckDigit(value.substring(0, 12)) == (value[12] - '0')
  }

  fun encode(raw: String): String {
    val value = raw.trim()
    if (value.isEmpty()) throw IllegalArgumentException("Barcode is empty.")
    return if (isValidEan13(value)) encodeEan13(value) else encodeCode128(value)
  }

  private fun ean13CheckDigit(first12: String): Int {
    var sum = 0
    for (i in 0 until 12) {
      val weight = if (i % 2 == 0) 1 else 3
      sum += (first12[i] - '0') * weight
    }
    return (10 - (sum % 10)) % 10
  }

  private fun encodeEan13(value: String): String {
    val parity = EAN_PARITY[value[0] - '0']
    val modules = StringBuilder("101")
    for (i in 1..6) {
      val digit = value[i] - '0'
      modules.append(if (parity[i - 1] == 'L') EAN_L[digit] else EAN_G[digit])
    }
    modules.append("01010")
    for (i in 7..12) modules.append(EAN_R[value[i] - '0'])
    modules.append("101")
    return modules.toString()
  }

  private fun encodeCode128(value: String): String {
    for (ch in value) {
      val code = ch.code
      if (code < 32 || code > 126) {
        throw IllegalArgumentException("Barcode cannot contain \"$ch\".")
      }
    }
    val values = code128Values(value)
    var checksum = values[0]
    for (i in 1 until values.size) checksum += values[i] * i
    val symbols = values + (checksum % 103) + STOP
    return symbols.joinToString("") { widthsToModules(CODE128_PATTERNS[it]) }
  }

  private fun code128Values(value: String): List<Int> {
    val allDigits = value.all { it.isDigit() }
    if (allDigits && value.length >= 4) {
      val even = value.length - (value.length % 2)
      val values = mutableListOf(START_C)
      var i = 0
      while (i < even) {
        values.add(value.substring(i, i + 2).toInt())
        i += 2
      }
      if (even < value.length) {
        values.add(CODE_B)
        values.add(value[even].code - 32)
      }
      return values
    }
    return listOf(START_B) + value.map { it.code - 32 }
  }

  private fun widthsToModules(widths: String): String {
    val out = StringBuilder()
    for (i in widths.indices) {
      val bar = if (i % 2 == 0) '1' else '0'
      repeat(widths[i] - '0') { out.append(bar) }
    }
    return out.toString()
  }
}
