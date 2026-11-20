#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Plain receipt text → ESC/POS. Devanagari lines are bitmaps; Latin stays text. */
@interface KdsReceiptRaster : NSObject
+ (NSData *)encodePlain:(NSString *)plain charsPerLine:(NSInteger)charsPerLine;
@end

NS_ASSUME_NONNULL_END
