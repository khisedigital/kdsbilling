#import <Foundation/Foundation.h>
#import "KdsPrintError.h"

NS_ASSUME_NONNULL_BEGIN

/**
 * Sends raw bytes (ESC/POS) to a network thermal printer: connect (IPv4/IPv6/DNS), write everything,
 * then half-close and wait briefly so the printer has read the data before the socket closes.
 */
@interface KdsTcpSender : NSObject

@property (nonatomic) NSTimeInterval connectTimeout;
/** Seconds without write progress before giving up (printer stopped reading). */
@property (nonatomic) NSTimeInterval writeTimeout;
/** Seconds to wait for the printer to close after all data was sent. */
@property (nonatomic) NSTimeInterval lingerSeconds;

- (BOOL)sendData:(NSData *)data toHost:(NSString *)host port:(int)port error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
