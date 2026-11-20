#import "KdsReceiptRaster.h"
#import <CoreText/CoreText.h>
#import <UIKit/UIKit.h>

@implementation KdsReceiptRaster

static BOOL KdsHasDevanagari(NSString *text) {
  if (!text.length) return NO;
  NSCharacterSet *set = [NSCharacterSet characterSetWithRange:NSMakeRange(0x0900, 0x0080)];
  return [text rangeOfCharacterFromSet:set].location != NSNotFound;
}

static NSInteger KdsEven(NSInteger value) {
  return value & ~1;
}

+ (void)printAreaForCols:(NSInteger)cols left:(NSInteger *)leftOut width:(NSInteger *)widthOut {
  NSInteger paper = cols <= 32 ? 384 : 576;
  NSInteger content = cols * 12;
  if (cols <= 32) {
    NSInteger left = 24;
    NSInteger width = KdsEven(MIN(content, paper - left));
    *leftOut = left;
    *widthOut = width;
    return;
  }
  NSInteger leftover = MAX(0, paper - content);
  NSInteger left = KdsEven(leftover / 2);
  NSInteger right = leftover - left;
  if (right - left > 1) {
    left += 2;
    right = leftover - left;
  }
  *leftOut = left;
  *widthOut = KdsEven(MAX(0, paper - left - right));
}

+ (NSArray<NSString *> *)wrapText:(NSString *)text maxWidth:(CGFloat)maxWidth font:(UIFont *)font {
  if (!text.length) return @[ @"" ];
  NSDictionary *attrs = @{ NSFontAttributeName: font };
  CGSize full = [text sizeWithAttributes:attrs];
  if (full.width <= maxWidth) return @[ text ];

  NSMutableArray<NSString *> *lines = [NSMutableArray new];
  NSString *current = @"";
  NSString *localeId = @"mr";
  CFLocaleRef locale = CFLocaleCreate(NULL, (__bridge CFStringRef)localeId);
  CFStringTokenizerRef tokenizer = CFStringTokenizerCreate(
    NULL,
    (__bridge CFStringRef)text,
    CFRangeMake(0, (CFIndex)text.length),
    kCFStringTokenizerUnitCharacter,
    locale);
  if (locale) CFRelease(locale);

  CFStringTokenizerTokenType type = CFStringTokenizerGoToTokenAtIndex(tokenizer, 0);
  while (type != kCFStringTokenizerTokenNone) {
    CFRange range = CFStringTokenizerGetCurrentTokenRange(tokenizer);
    NSString *piece = [text substringWithRange:NSMakeRange((NSUInteger)range.location, (NSUInteger)range.length)];
    NSString *candidate = [current stringByAppendingString:piece];
    CGFloat width = [candidate sizeWithAttributes:attrs].width;
    if (!current.length || width <= maxWidth) {
      current = candidate;
    } else {
      [lines addObject:current];
      current = piece;
    }
    type = CFStringTokenizerAdvanceToNextToken(tokenizer);
  }
  CFRelease(tokenizer);
  if (current.length) [lines addObject:current];
  return lines.count ? lines : @[ text ];
}

+ (UIImage *)solidify:(UIImage *)source {
  CGImageRef cg = source.CGImage;
  if (!cg) return source;
  size_t width = CGImageGetWidth(cg);
  size_t height = CGImageGetHeight(cg);
  size_t bytesPerRow = width * 4;
  UInt8 *pixels = calloc(height * bytesPerRow, 1);
  if (!pixels) return source;
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef ctx = CGBitmapContextCreate(
    pixels, width, height, 8, bytesPerRow, space,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!ctx) {
    free(pixels);
    return source;
  }
  CGContextDrawImage(ctx, CGRectMake(0, 0, width, height), cg);
  for (size_t i = 0; i < width * height; i++) {
    size_t o = i * 4;
    NSInteger lum = (pixels[o] * 299 + pixels[o + 1] * 587 + pixels[o + 2] * 114) / 1000;
    UInt8 v = lum < 112 ? 0 : 255;
    pixels[o] = v;
    pixels[o + 1] = v;
    pixels[o + 2] = v;
    pixels[o + 3] = 255;
  }
  CGImageRef outCg = CGBitmapContextCreateImage(ctx);
  CGContextRelease(ctx);
  free(pixels);
  if (!outCg) return source;
  UIImage *out = [UIImage imageWithCGImage:outCg scale:1.0 orientation:UIImageOrientationUp];
  CGImageRelease(outCg);
  return out;
}

+ (UIImage *)renderLine:(NSString *)text width:(NSInteger)width {
  UIFont *textFont = [UIFont systemFontOfSize:20 weight:UIFontWeightRegular];
  UIFont *digitFont = [UIFont monospacedDigitSystemFontOfSize:20 weight:UIFontWeightRegular];
  NSString *trimmed = [text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  NSUInteger leadSpaces = 0;
  while (leadSpaces < text.length && [text characterAtIndex:leadSpaces] == ' ') leadSpaces++;
  BOOL centered = trimmed.length > 0 && ![trimmed isEqualToString:text] && leadSpaces >= 2;

  NSRegularExpression *amountRe = [NSRegularExpression
    regularExpressionWithPattern:@"^(.*\\S)\\s+(\\d+(?:\\.\\d+)?\\s+\\d+\\.\\d{2}\\s+\\d+\\.\\d{2})\\s*$"
    options:0 error:nil];
  NSTextCheckingResult *amount = centered ? nil : [amountRe firstMatchInString:text options:0 range:NSMakeRange(0, text.length)];

  NSString *name;
  NSString *tail = @"";
  if (centered) {
    name = trimmed;
  } else if (amount) {
    name = [[text substringWithRange:[amount rangeAtIndex:1]]
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    tail = [[text substringWithRange:[amount rangeAtIndex:2]]
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  } else {
    name = trimmed.length ? trimmed : text;
  }

  CGFloat tailWidth = 0;
  if (tail.length) {
    tailWidth = [tail sizeWithAttributes:@{ NSFontAttributeName: digitFont }].width + 8;
  }
  CGFloat nameMax = centered ? (width - 8) : MAX(40, width - tailWidth - 4);
  NSArray<NSString *> *rows = [self wrapText:name maxWidth:nameMax font:textFont];

  CGFloat ascent = textFont.ascender;
  CGFloat descent = -textFont.descender;
  CGFloat topGap = 6;
  NSInteger rowH = (NSInteger)ceil(ascent + descent + topGap);
  if (rowH < 1) rowH = 1;
  NSInteger height = rowH * (NSInteger)rows.count;
  CGSize size = CGSizeMake(MAX(8, width), MAX(1, height));

  UIGraphicsBeginImageContextWithOptions(size, YES, 1.0);
  [[UIColor whiteColor] setFill];
  UIRectFill(CGRectMake(0, 0, size.width, size.height));
  [[UIColor blackColor] setFill];

  [rows enumerateObjectsUsingBlock:^(NSString *row, NSUInteger index, BOOL *stop) {
    CGFloat baseline = ascent + topGap + index * rowH;
    if (centered) {
      CGSize rowSize = [row sizeWithAttributes:@{ NSFontAttributeName: textFont }];
      [row drawAtPoint:CGPointMake((size.width - rowSize.width) / 2.0, baseline - ascent)
        withAttributes:@{ NSFontAttributeName: textFont, NSForegroundColorAttributeName: [UIColor blackColor] }];
    } else {
      [row drawAtPoint:CGPointMake(2, baseline - ascent)
        withAttributes:@{ NSFontAttributeName: textFont, NSForegroundColorAttributeName: [UIColor blackColor] }];
      if (tail.length && index == 0) {
        CGSize tailSize = [tail sizeWithAttributes:@{ NSFontAttributeName: digitFont }];
        [tail drawAtPoint:CGPointMake(size.width - 2 - tailSize.width, baseline - ascent)
          withAttributes:@{ NSFontAttributeName: digitFont, NSForegroundColorAttributeName: [UIColor blackColor] }];
      }
    }
  }];

  UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();
  return [self solidify:image];
}

+ (UIImage *)renderReceipt:(NSString *)plain width:(NSInteger)width {
  NSArray<NSString *> *lines = [[plain stringByReplacingOccurrencesOfString:@"\r" withString:@""]
    componentsSeparatedByString:@"\n"];
  NSMutableArray<UIImage *> *parts = [NSMutableArray new];
  for (NSString *line in lines) {
    NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if (!trimmed.length) {
      UIGraphicsBeginImageContextWithOptions(CGSizeMake(MAX(8, width), 8), YES, 1.0);
      [[UIColor whiteColor] setFill];
      UIRectFill(CGRectMake(0, 0, MAX(8, width), 8));
      UIImage *blank = UIGraphicsGetImageFromCurrentImageContext();
      UIGraphicsEndImageContext();
      if (blank) [parts addObject:blank];
    } else {
      UIImage *row = [self renderLine:line width:width];
      if (row) [parts addObject:row];
    }
  }
  if (!parts.count) {
    UIGraphicsBeginImageContextWithOptions(CGSizeMake(MAX(8, width), 8), YES, 1.0);
    [[UIColor whiteColor] setFill];
    UIRectFill(CGRectMake(0, 0, MAX(8, width), 8));
    UIImage *blank = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    return blank;
  }
  CGFloat height = 0;
  for (UIImage *part in parts) height += part.size.height;
  CGSize size = CGSizeMake(MAX(8, width), MAX(1, height));
  UIGraphicsBeginImageContextWithOptions(size, YES, 1.0);
  [[UIColor whiteColor] setFill];
  UIRectFill(CGRectMake(0, 0, size.width, size.height));
  CGFloat y = 0;
  for (UIImage *part in parts) {
    [part drawAtPoint:CGPointMake(0, y)];
    y += part.size.height;
  }
  UIImage *stacked = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();
  return stacked;
}

+ (void)appendBitImage:(NSMutableData *)out image:(UIImage *)image {
  CGImageRef cg = image.CGImage;
  if (!cg) return;
  size_t width = CGImageGetWidth(cg);
  size_t height = CGImageGetHeight(cg);
  size_t bytesPerRow = width * 4;
  UInt8 *pixels = calloc(height * bytesPerRow, 1);
  if (!pixels) return;
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef ctx = CGBitmapContextCreate(
    pixels, width, height, 8, bytesPerRow, space,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!ctx) {
    free(pixels);
    return;
  }
  CGContextDrawImage(ctx, CGRectMake(0, 0, width, height), cg);
  CGContextRelease(ctx);

  BOOL (^black)(NSInteger, NSInteger) = ^BOOL(NSInteger x, NSInteger y) {
    if (x < 0 || y < 0 || x >= (NSInteger)width || y >= (NSInteger)height) return NO;
    size_t o = ((size_t)y * width + (size_t)x) * 4;
    NSInteger lum = (pixels[o] * 299 + pixels[o + 1] * 587 + pixels[o + 2] * 114) / 1000;
    return lum < 112;
  };

  const UInt8 lineSpacing[] = { 0x1B, 0x33, 24 };
  [out appendBytes:lineSpacing length:sizeof(lineSpacing)];
  for (NSInteger band = 0; band < (NSInteger)height; band += 24) {
    UInt8 header[] = { 0x1B, 0x2A, 33, (UInt8)(width & 0xFF), (UInt8)((width >> 8) & 0xFF) };
    [out appendBytes:header length:sizeof(header)];
    for (NSInteger x = 0; x < (NSInteger)width; x++) {
      for (NSInteger k = 0; k < 3; k++) {
        UInt8 slice = 0;
        for (NSInteger b = 0; b < 8; b++) {
          if (black(x, band + k * 8 + b)) slice |= (UInt8)(0x80 >> b);
        }
        [out appendBytes:&slice length:1];
      }
    }
    UInt8 lf = 0x0A;
    [out appendBytes:&lf length:1];
  }
  const UInt8 resetSpacing[] = { 0x1B, 0x32 };
  [out appendBytes:resetSpacing length:sizeof(resetSpacing)];
  free(pixels);
}

+ (NSData *)encodePlain:(NSString *)plain charsPerLine:(NSInteger)charsPerLine {
  NSInteger cols = MAX(16, MIN(96, charsPerLine));
  NSInteger left = 0;
  NSInteger width = 0;
  [self printAreaForCols:cols left:&left width:&width];

  NSMutableData *out = [NSMutableData new];
  const UInt8 init[] = {
    0x1B, 0x40,
    0x1B, 0x4D, 0x00,
    0x1B, 0x32,
    0x1B, 0x45, 0x00, 0x1D, 0x21, 0x00, 0x1B, 0x21, 0x00,
    0x1B, 0x61, 0x00,
    0x1D, 0x4C, (UInt8)(left & 0xFF), (UInt8)((left >> 8) & 0xFF),
    0x1D, 0x57, (UInt8)(width & 0xFF), (UInt8)((width >> 8) & 0xFF),
  };
  [out appendBytes:init length:sizeof(init)];

  if (KdsHasDevanagari(plain ?: @"")) {
    const UInt8 cancel[] = { 0x1C, 0x2E, 0x1B, 0x74, 0x00 };
    [out appendBytes:cancel length:sizeof(cancel)];
    // One continuous picture. Shop-name then text makes many heads stop after the name.
    NSInteger pictureWidth = MAX(8, width - 16);
    UIImage *ticket = [self renderReceipt:plain ?: @"" width:pictureWidth];
    [self appendBitImage:out image:ticket];
  } else {
    NSArray<NSString *> *lines = [(plain ?: @"") componentsSeparatedByString:@"\n"];
    for (NSString *line in lines) {
      for (NSUInteger i = 0; i < line.length; i++) {
        unichar ch = [line characterAtIndex:i];
        if (ch >= 0x20 && ch <= 0x7E) {
          UInt8 b = (UInt8)ch;
          [out appendBytes:&b length:1];
        }
      }
      UInt8 lf = 0x0A;
      [out appendBytes:&lf length:1];
    }
  }

  UInt8 last = 0;
  if (out.length) [out getBytes:&last range:NSMakeRange(out.length - 1, 1)];
  if (!out.length || last != 0x0A) {
    UInt8 lf = 0x0A;
    [out appendBytes:&lf length:1];
  }
  for (int i = 0; i < 6; i++) {
    UInt8 lf = 0x0A;
    [out appendBytes:&lf length:1];
  }
  const UInt8 cut[] = { 0x1D, 0x56, 0x01 };
  [out appendBytes:cut length:sizeof(cut)];
  return out;
}

@end
