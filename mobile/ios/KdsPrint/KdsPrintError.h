#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

extern NSErrorDomain const KdsPrintTcpErrorDomain;

typedef NS_ENUM(NSInteger, KdsPrintTcpError) {
  KdsPrintTcpErrorHostNotFound = 1,
  KdsPrintTcpErrorConnectFailed,
  KdsPrintTcpErrorConnectTimeout,
  KdsPrintTcpErrorWriteFailed,
  KdsPrintTcpErrorTimeout,
};

NSError *KdsPrintMakeError(NSErrorDomain domain, NSInteger code, NSString *message, NSDictionary *_Nullable extra);

/** Logs "[KdsPrint][layer] message". Set KdsPrintLoggingEnabled = NO to silence (tests). */
extern BOOL KdsPrintLoggingEnabled;
void KdsPrintLog(NSString *layer, NSString *format, ...) NS_FORMAT_FUNCTION(2, 3);

NS_ASSUME_NONNULL_END
