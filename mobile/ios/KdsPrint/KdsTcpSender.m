#import "KdsTcpSender.h"
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

@implementation KdsTcpSender

- (instancetype)init
{
  if ((self = [super init])) {
    _connectTimeout = 6;
    _writeTimeout = 15;
    _lingerSeconds = 3;
  }
  return self;
}

static int RemainingMs(CFAbsoluteTime deadline)
{
  double ms = (deadline - CFAbsoluteTimeGetCurrent()) * 1000.0;
  return ms <= 0 ? 0 : (int)MIN(ms, (double)INT_MAX);
}

- (int)connectToHost:(NSString *)host port:(int)port error:(NSError **)error
{
  struct addrinfo hints = {0};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo *result = NULL;
  NSString *portString = [NSString stringWithFormat:@"%d", port];
  int gai = getaddrinfo(host.UTF8String, portString.UTF8String, &hints, &result);
  if (gai != 0 || !result) {
    if (error) {
      *error = KdsPrintMakeError(KdsPrintTcpErrorDomain, KdsPrintTcpErrorHostNotFound,
                                 [NSString stringWithFormat:@"Printer address \"%@\" not found (%s).", host,
                                                            gai_strerror(gai)], nil);
    }
    return -1;
  }

  int lastErrno = 0;
  BOOL timedOut = NO;
  int fd = -1;
  for (struct addrinfo *ai = result; ai && fd < 0; ai = ai->ai_next) {
    int s = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
    if (s < 0) {
      lastErrno = errno;
      continue;
    }
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
    fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK);
    int rc = connect(s, ai->ai_addr, ai->ai_addrlen);
    if (rc != 0 && errno == EINPROGRESS) {
      struct pollfd pfd = {.fd = s, .events = POLLOUT};
      CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + self.connectTimeout;
      int pr;
      do {
        pr = poll(&pfd, 1, RemainingMs(deadline));
      } while (pr < 0 && errno == EINTR);
      if (pr == 0) {
        timedOut = YES;
        rc = -1;
      } else {
        int soError = 0;
        socklen_t len = sizeof(soError);
        getsockopt(s, SOL_SOCKET, SO_ERROR, &soError, &len);
        rc = soError ? -1 : 0;
        if (soError) lastErrno = soError;
      }
    } else if (rc != 0) {
      lastErrno = errno;
    }
    if (rc == 0) {
      fd = s;
    } else {
      close(s);
    }
  }
  freeaddrinfo(result);

  if (fd < 0 && error) {
    if (timedOut) {
      *error = KdsPrintMakeError(KdsPrintTcpErrorDomain, KdsPrintTcpErrorConnectTimeout,
                                 [NSString stringWithFormat:@"No answer from %@:%d within %.0f s. Check the printer is on "
                                                            @"and on the same Wi-Fi.", host, port, self.connectTimeout],
                                 nil);
    } else {
      *error = KdsPrintMakeError(KdsPrintTcpErrorDomain, KdsPrintTcpErrorConnectFailed,
                                 [NSString stringWithFormat:@"Could not connect to %@:%d (%s). Check the IP and port.",
                                                            host, port, strerror(lastErrno)],
                                 @{@"errno" : @(lastErrno)});
    }
  }
  if (fd >= 0) KdsPrintLog(@"TCP", @"connected to %@:%d", host, port);
  return fd;
}

/** Discards anything the printer sent (status bytes); unread data would turn close() into a reset. */
static BOOL DrainReadable(int fd)
{
  uint8_t buffer[1024];
  while (YES) {
    ssize_t n = recv(fd, buffer, sizeof(buffer), 0);
    if (n > 0) continue;
    return n == 0;
  }
}

- (BOOL)sendData:(NSData *)data toHost:(NSString *)host port:(int)port error:(NSError **)error
{
  int fd = [self connectToHost:host port:port error:error];
  if (fd < 0) return NO;

  const uint8_t *bytes = data.bytes;
  NSUInteger total = data.length;
  NSUInteger sent = 0;
  NSError *failure = nil;
  CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + self.writeTimeout;
  while (sent < total && !failure) {
    struct pollfd pfd = {.fd = fd, .events = POLLOUT};
    int pr = poll(&pfd, 1, RemainingMs(deadline));
    if (pr < 0 && errno == EINTR) continue;
    if (pr <= 0) {
      failure = KdsPrintMakeError(KdsPrintTcpErrorDomain, KdsPrintTcpErrorTimeout,
                                  [NSString stringWithFormat:@"Printer stopped accepting data after %lu of %lu bytes "
                                                             @"(timeout %.0f s). Check paper and cover.",
                                                             (unsigned long)sent, (unsigned long)total,
                                                             self.writeTimeout], nil);
      break;
    }
    if (pfd.revents & POLLIN) DrainReadable(fd);
    ssize_t n = send(fd, bytes + sent, MIN((NSUInteger)16384, total - sent), 0);
    if (n > 0) {
      sent += (NSUInteger)n;
      deadline = CFAbsoluteTimeGetCurrent() + self.writeTimeout;
    } else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
      failure = KdsPrintMakeError(KdsPrintTcpErrorDomain, KdsPrintTcpErrorWriteFailed,
                                  [NSString stringWithFormat:@"Printer closed the connection after %lu of %lu bytes "
                                                             @"(%s).", (unsigned long)sent, (unsigned long)total,
                                                             strerror(errno)], nil);
    }
  }

  if (!failure) {
    // Wait until the printer has acknowledged every byte, so closing cannot drop the tail of the receipt.
    CFAbsoluteTime lingerDeadline = CFAbsoluteTimeGetCurrent() + self.lingerSeconds;
    int unacked = 0;
    socklen_t len = sizeof(unacked);
    while (getsockopt(fd, SOL_SOCKET, SO_NWRITE, &unacked, &len) == 0 && unacked > 0 &&
           CFAbsoluteTimeGetCurrent() < lingerDeadline) {
      struct pollfd pfd = {.fd = fd, .events = POLLIN};
      if (poll(&pfd, 1, 20) > 0 && DrainReadable(fd)) break;
    }
    if (unacked > 0) KdsPrintLog(@"TCP", @"%d bytes still unacknowledged at close", unacked);
    shutdown(fd, SHUT_WR);
    DrainReadable(fd);
    KdsPrintLog(@"TCP", @"sent %lu bytes to %@:%d", (unsigned long)total, host, port);
  }
  close(fd);

  if (failure) {
    if (error) *error = failure;
    return NO;
  }
  return YES;
}

@end
