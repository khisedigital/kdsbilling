// Unit tests for KdsTcpSender against local fake printers. Run with ./run-tests.sh
#import <Foundation/Foundation.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>
#import "KdsTcpSender.h"

static int gChecks = 0;
static int gFailures = 0;

#define CHECK(cond, ...)                                                       \
  do {                                                                         \
    gChecks++;                                                                 \
    if (!(cond)) {                                                             \
      gFailures++;                                                             \
      printf("  FAIL %s:%d %s\n", __FILE__, __LINE__,                          \
             [[NSString stringWithFormat:__VA_ARGS__] UTF8String]);            \
    }                                                                          \
  } while (0)

/** Listens on 127.0.0.1 and runs `handler` on the first accepted connection in the background. */
@interface FakePrinter : NSObject
@property (nonatomic, readonly) int port;
- (instancetype)initWithHandler:(void (^)(int fd))handler;
- (void)waitDone;
@end

@implementation FakePrinter {
  int _listenFd;
  dispatch_semaphore_t _done;
}

- (instancetype)initWithHandler:(void (^)(int fd))handler
{
  if ((self = [super init])) {
    _listenFd = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(_listenFd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    int small = 4096;  // tiny receive buffer forces many partial writes on the client
    setsockopt(_listenFd, SOL_SOCKET, SO_RCVBUF, &small, sizeof(small));
    struct sockaddr_in addr = {.sin_family = AF_INET, .sin_port = 0};
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bind(_listenFd, (struct sockaddr *)&addr, sizeof(addr));
    listen(_listenFd, 1);
    socklen_t len = sizeof(addr);
    getsockname(_listenFd, (struct sockaddr *)&addr, &len);
    _port = ntohs(addr.sin_port);
    _done = dispatch_semaphore_create(0);
    int listenFd = _listenFd;
    dispatch_semaphore_t done = _done;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      int fd = accept(listenFd, NULL, NULL);
      if (fd >= 0) {
        handler(fd);
        close(fd);
      }
      dispatch_semaphore_signal(done);
    });
  }
  return self;
}

- (void)waitDone
{
  dispatch_semaphore_wait(_done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
  close(_listenFd);
}

@end

static NSData *Pattern(NSUInteger length)
{
  NSMutableData *d = [NSMutableData dataWithLength:length];
  uint8_t *p = d.mutableBytes;
  for (NSUInteger i = 0; i < length; i++) p[i] = (uint8_t)(i * 31 + 7);
  return d;
}

/** Reads until EOF in small pieces, slowly, like a printer working through its buffer. */
static NSData *ReadAll(int fd, useconds_t pauseUs)
{
  NSMutableData *all = [NSMutableData data];
  uint8_t buf[512];
  ssize_t n;
  while ((n = recv(fd, buf, sizeof(buf), 0)) > 0) {
    [all appendBytes:buf length:(NSUInteger)n];
    if (pauseUs) usleep(pauseUs);
  }
  return all;
}

static void TestDeliversAllBytes(void)
{
  NSData *payload = Pattern(300 * 1024);
  __block NSData *received = nil;
  FakePrinter *p = [[FakePrinter alloc] initWithHandler:^(int fd) {
    received = ReadAll(fd, 50);
  }];
  NSError *error = nil;
  BOOL ok = [[KdsTcpSender new] sendData:payload toHost:@"127.0.0.1" port:p.port error:&error];
  [p waitDone];
  CHECK(ok, @"send failed: %@", error);
  CHECK([received isEqualToData:payload], @"received %lu of %lu bytes, intact=%d", (unsigned long)received.length,
        (unsigned long)payload.length, [received isEqualToData:payload]);
}

static void TestPrinterSendsStatusBytes(void)
{
  // Some printers push status bytes back; unread input must not reset the connection or lose the tail.
  NSData *payload = Pattern(64 * 1024);
  __block NSData *received = nil;
  FakePrinter *p = [[FakePrinter alloc] initWithHandler:^(int fd) {
    const uint8_t status[] = {0x12, 0x00, 0x00, 0x0F};
    send(fd, status, sizeof(status), 0);
    received = ReadAll(fd, 0);
  }];
  NSError *error = nil;
  BOOL ok = [[KdsTcpSender new] sendData:payload toHost:@"localhost" port:p.port error:&error];
  [p waitDone];
  CHECK(ok && [received isEqualToData:payload], @"status bytes: ok=%d received %lu error %@", ok,
        (unsigned long)received.length, error);
}

static void TestPrinterStopsReading(void)
{
  KdsTcpSender *sender = [KdsTcpSender new];
  sender.writeTimeout = 1;
  FakePrinter *p = [[FakePrinter alloc] initWithHandler:^(int fd) {
    usleep(2500 * 1000);  // never reads: the client must time out instead of hanging
  }];
  NSError *error = nil;
  NSDate *t0 = [NSDate date];
  BOOL ok = [sender sendData:Pattern(16 * 1024 * 1024) toHost:@"127.0.0.1" port:p.port error:&error];
  CHECK(!ok && error.code == KdsPrintTcpErrorTimeout && -[t0 timeIntervalSinceNow] < 2.5,
        @"stalled printer -> ok=%d %@ after %.1fs", ok, error, -[t0 timeIntervalSinceNow]);
  [p waitDone];
}

static void TestConnectionErrors(void)
{
  // Nothing listening.
  FakePrinter *p = [[FakePrinter alloc] initWithHandler:^(int fd) {}];
  int port = p.port;
  [p waitDone];  // closes the listener without accepting
  NSError *error = nil;
  CHECK(![[KdsTcpSender new] sendData:Pattern(10) toHost:@"127.0.0.1" port:port error:&error] &&
            error.code == KdsPrintTcpErrorConnectFailed && [error.domain isEqualToString:KdsPrintTcpErrorDomain],
        @"refused -> %@", error);

  error = nil;
  CHECK(![[KdsTcpSender new] sendData:Pattern(10) toHost:@"printer.invalid" port:9100 error:&error] &&
            error.code == KdsPrintTcpErrorHostNotFound,
        @"dns -> %@", error);

  KdsTcpSender *sender = [KdsTcpSender new];
  sender.connectTimeout = 1;
  error = nil;
  NSDate *t0 = [NSDate date];
  BOOL ok = [sender sendData:Pattern(10) toHost:@"10.255.255.1" port:9100 error:&error];
  CHECK(!ok && (error.code == KdsPrintTcpErrorConnectTimeout || error.code == KdsPrintTcpErrorConnectFailed) &&
            -[t0 timeIntervalSinceNow] < 2.5,
        @"unroutable -> %@ after %.1fs", error, -[t0 timeIntervalSinceNow]);
}

int main(int argc, const char *argv[])
{
  @autoreleasepool {
    setvbuf(stdout, NULL, _IONBF, 0);
    KdsPrintLoggingEnabled = getenv("KDS_LOG") != NULL;
    signal(SIGPIPE, SIG_IGN);
    struct {
      const char *name;
      void (*fn)(void);
    } tests[] = {
      {"delivers all bytes (partial writes)", TestDeliversAllBytes},
      {"printer sends status bytes", TestPrinterSendsStatusBytes},
      {"printer stops reading -> timeout", TestPrinterStopsReading},
      {"refused / DNS / connect timeout", TestConnectionErrors},
    };
    for (size_t i = 0; i < sizeof(tests) / sizeof(tests[0]); i++) {
      int before = gFailures;
      NSDate *t0 = [NSDate date];
      tests[i].fn();
      printf("%s  %s (%.1fs)\n", gFailures == before ? "PASS" : "FAIL", tests[i].name, -[t0 timeIntervalSinceNow]);
    }
    printf("\n%d checks, %d failed\n", gChecks, gFailures);
  }
  return gFailures ? 1 : 0;
}
