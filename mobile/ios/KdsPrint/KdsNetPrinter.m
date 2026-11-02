#import <React/RCTBridgeModule.h>
#import "KdsTcpSender.h"

/** Sends ESC/POS bytes to Wi-Fi / LAN thermal printers (raw TCP, usually port 9100). */
@interface KdsNetPrinter : NSObject <RCTBridgeModule>
@end

@implementation KdsNetPrinter

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    queue = dispatch_queue_create("com.kdspoz.netprinter", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

RCT_EXPORT_METHOD(printRaw:(NSString *)host
                  port:(double)port
                  base64:(NSString *)base64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSString *trimmed = [host stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  if (!trimmed.length) {
    reject(@"PRINT_FAILED", @"No network printer IP configured.", nil);
    return;
  }
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 ?: @"" options:0];
  if (!data.length) {
    reject(@"PRINT_FAILED", @"Nothing to print.", nil);
    return;
  }
  NSError *error = nil;
  if ([[KdsTcpSender new] sendData:data toHost:trimmed port:port > 0 ? (int)port : 9100 error:&error]) {
    resolve(nil);
  } else {
    reject(@"PRINT_FAILED", error.localizedDescription ?: @"Printing failed.", error);
  }
}

@end
