#import <React/RCTBridgeModule.h>
#import "KdsReceiptRaster.h"

/**
 * Receipt helpers shared with Android's KdsLabelPrinter.encodeReceipt.
 * Label printing on iOS still goes through JS rasters + KdsBle/KdsNet.
 */
@interface KdsLabelPrinter : NSObject <RCTBridgeModule>
@end

@implementation KdsLabelPrinter

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

RCT_EXPORT_METHOD(encodeReceipt:(NSString *)text
                  charsPerLine:(nonnull NSNumber *)charsPerLine
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    NSData *bytes = [KdsReceiptRaster encodePlain:text ?: @"" charsPerLine:charsPerLine.integerValue];
    resolve([bytes base64EncodedStringWithOptions:0]);
  } @catch (NSException *ex) {
    reject(@"RECEIPT_ENCODE", ex.reason ?: @"Could not encode receipt", nil);
  }
}

@end
