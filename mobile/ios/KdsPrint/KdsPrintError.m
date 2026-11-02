#import "KdsPrintError.h"

NSErrorDomain const KdsPrintTcpErrorDomain = @"KdsPrint.TCP";

BOOL KdsPrintLoggingEnabled = YES;

NSError *KdsPrintMakeError(NSErrorDomain domain, NSInteger code, NSString *message, NSDictionary *extra)
{
  NSMutableDictionary *info = [NSMutableDictionary dictionaryWithDictionary:extra ?: @{}];
  info[NSLocalizedDescriptionKey] = message;
  NSString *layer = [domain componentsSeparatedByString:@"."].lastObject;
  KdsPrintLog(layer, @"error %ld: %@", (long)code, message);
  return [NSError errorWithDomain:domain code:code userInfo:info];
}

void KdsPrintLog(NSString *layer, NSString *format, ...)
{
  if (!KdsPrintLoggingEnabled) return;
  va_list args;
  va_start(args, format);
  NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);
  NSLog(@"[KdsPrint][%@] %@", layer, message);
}
