#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTBridgeModule.h>

/**
 * ESC/POS thermal printing over Bluetooth Low Energy.
 * iOS cannot use Bluetooth Classic (SPP) printers, so only BLE-capable printers are listed.
 */
@interface KdsBlePrinter : NSObject <RCTBridgeModule, CBCentralManagerDelegate, CBPeripheralDelegate>
@end

typedef void (^KdsDone)(NSString *_Nullable error);

static const NSUInteger KdsMaxChunk = 100;
/**
 * Pause between write-without-response chunks. iOS only throttles to its own radio queue, not to the
 * printer's buffer; sending faster makes cheap printers drop bytes, which corrupts raster images (barcodes).
 */
static const int64_t KdsChunkDelayMs = 20;

@implementation KdsBlePrinter {
  CBCentralManager *_central;
  NSMutableArray<KdsDone> *_powerWaiters;
  NSMutableDictionary<NSString *, CBPeripheral *> *_found;
  NSMutableDictionary<NSString *, NSString *> *_names;

  CBPeripheral *_peripheral;
  CBCharacteristic *_characteristic;
  NSInteger _servicesLeft;
  KdsDone _connectDone;

  NSData *_pending;
  NSUInteger _offset;
  BOOL _withResponse;
  BOOL _waitingForReady;
  RCTPromiseResolveBlock _printResolve;
  RCTPromiseRejectBlock _printReject;
}

RCT_EXPORT_MODULE();

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

#pragma mark - Power state

- (void)whenPoweredOn:(KdsDone)block
{
  if (!_central) {
    _powerWaiters = [NSMutableArray new];
    _found = [NSMutableDictionary new];
    _names = [NSMutableDictionary new];
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:nil];
  }
  NSString *problem = [self problemForState:_central.state];
  if (_central.state == CBManagerStatePoweredOn) {
    block(nil);
  } else if (problem) {
    block(problem);
  } else {
    [_powerWaiters addObject:block];
  }
}

- (nullable NSString *)problemForState:(CBManagerState)state
{
  switch (state) {
    case CBManagerStatePoweredOff:
      return @"Bluetooth is off. Turn it on in Settings and try again.";
    case CBManagerStateUnauthorized:
      return @"Bluetooth permission denied. Allow Bluetooth for KDSPOZ in Settings.";
    case CBManagerStateUnsupported:
      return @"This device does not support Bluetooth printers.";
    default:
      return nil;
  }
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central
{
  if (central.state == CBManagerStateUnknown || central.state == CBManagerStateResetting) return;
  NSString *problem = central.state == CBManagerStatePoweredOn ? nil : [self problemForState:central.state];
  if (central.state != CBManagerStatePoweredOn && !problem) problem = @"Bluetooth is not available.";
  NSArray<KdsDone> *waiters = [_powerWaiters copy];
  [_powerWaiters removeAllObjects];
  for (KdsDone waiter in waiters) waiter(problem);
}

#pragma mark - Scan

RCT_EXPORT_METHOD(scan:(double)timeoutMs
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [self whenPoweredOn:^(NSString *error) {
    if (error) {
      reject(@"BLUETOOTH", error, nil);
      return;
    }
    [self->_central scanForPeripheralsWithServices:nil options:nil];
    NSArray *known = [self->_central retrieveConnectedPeripheralsWithServices:[self printerServices]];
    for (CBPeripheral *p in known) [self remember:p name:p.name];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(timeoutMs, 2000) * NSEC_PER_MSEC)),
                   dispatch_get_main_queue(), ^{
      [self->_central stopScan];
      NSMutableArray *list = [NSMutableArray new];
      [self->_names enumerateKeysAndObjectsUsingBlock:^(NSString *address, NSString *name, BOOL *stop) {
        [list addObject:@{@"name" : name, @"address" : address}];
      }];
      [list sortUsingDescriptors:@[ [NSSortDescriptor sortDescriptorWithKey:@"name" ascending:YES] ]];
      resolve(list);
    });
  }];
}

- (NSArray<CBUUID *> *)printerServices
{
  return @[
    [CBUUID UUIDWithString:@"18F0"],
    [CBUUID UUIDWithString:@"FF00"],
    [CBUUID UUIDWithString:@"FFE0"],
    [CBUUID UUIDWithString:@"E7810A71-73AE-499D-8C15-FAA9AEF0C3F2"],
    [CBUUID UUIDWithString:@"49535343-FE7D-4AE5-8FA9-9FAFD205E455"],
  ];
}

- (void)remember:(CBPeripheral *)peripheral name:(NSString *)name
{
  if (!name.length) return;
  NSString *address = peripheral.identifier.UUIDString;
  _found[address] = peripheral;
  _names[address] = name;
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *, id> *)advertisementData
                  RSSI:(NSNumber *)RSSI
{
  NSString *name = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey];
  [self remember:peripheral name:name];
}

#pragma mark - Connect

- (void)connect:(NSString *)address done:(KdsDone)done
{
  if (_peripheral && [_peripheral.identifier.UUIDString isEqualToString:address] &&
      _peripheral.state == CBPeripheralStateConnected && _characteristic) {
    done(nil);
    return;
  }

  CBPeripheral *peripheral = _found[address];
  if (!peripheral) {
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:address];
    if (uuid) peripheral = [_central retrievePeripheralsWithIdentifiers:@[ uuid ]].firstObject;
  }
  if (!peripheral) {
    done(@"Printer not found. Turn it on, then Scan printers again in Printer Settings.");
    return;
  }

  if (_peripheral && _peripheral != peripheral) [_central cancelPeripheralConnection:_peripheral];
  _peripheral = peripheral;
  _characteristic = nil;
  _peripheral.delegate = self;
  _connectDone = done;
  [_central connectPeripheral:peripheral options:nil];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(12 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (self->_connectDone && self->_peripheral == peripheral) {
      [self->_central cancelPeripheralConnection:peripheral];
      [self finishConnect:@"Could not connect to the printer. Make sure it is on and close by."];
    }
  });
}

- (void)finishConnect:(nullable NSString *)error
{
  KdsDone done = _connectDone;
  _connectDone = nil;
  if (done) done(error);
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral
{
  if (peripheral != _peripheral) return;
  [peripheral discoverServices:nil];
}

- (void)centralManager:(CBCentralManager *)central
    didFailToConnectPeripheral:(CBPeripheral *)peripheral
                         error:(NSError *)error
{
  if (peripheral != _peripheral) return;
  [self finishConnect:error.localizedDescription ?: @"Could not connect to the printer."];
}

- (void)centralManager:(CBCentralManager *)central
    didDisconnectPeripheral:(CBPeripheral *)peripheral
                      error:(NSError *)error
{
  if (peripheral != _peripheral) return;
  _characteristic = nil;
  [self finishConnect:@"Printer disconnected."];
  [self finishPrint:@"Printer disconnected while printing."];
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error
{
  if (error || !peripheral.services.count) {
    [self finishConnect:@"Printer did not report any services."];
    return;
  }
  _servicesLeft = peripheral.services.count;
  for (CBService *service in peripheral.services) {
    [peripheral discoverCharacteristics:nil forService:service];
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
    didDiscoverCharacteristicsForService:(CBService *)service
                                   error:(NSError *)error
{
  _servicesLeft -= 1;
  if (_servicesLeft > 0) return;

  CBCharacteristic *best = nil;
  NSInteger bestScore = -1;
  NSArray<CBUUID *> *preferred = [self printerServices];
  for (CBService *s in peripheral.services) {
    for (CBCharacteristic *c in s.characteristics) {
      CBCharacteristicProperties props = c.properties;
      BOOL writable = (props & CBCharacteristicPropertyWriteWithoutResponse) || (props & CBCharacteristicPropertyWrite);
      if (!writable) continue;
      NSInteger score = 1;
      if ([preferred containsObject:s.UUID]) score += 2;
      if (props & CBCharacteristicPropertyWriteWithoutResponse) score += 1;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
  }
  if (!best) {
    [self finishConnect:@"This printer does not accept data over Bluetooth LE."];
    return;
  }
  _characteristic = best;
  [self finishConnect:nil];
}

#pragma mark - Print

RCT_EXPORT_METHOD(print:(NSString *)address
                  base64:(NSString *)base64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (!data.length) {
    reject(@"PRINT_FAILED", @"Nothing to print.", nil);
    return;
  }
  if (_printResolve) {
    reject(@"PRINT_BUSY", @"Printer is busy. Try again in a moment.", nil);
    return;
  }
  [self whenPoweredOn:^(NSString *error) {
    if (error) {
      reject(@"BLUETOOTH", error, nil);
      return;
    }
    [self connect:address done:^(NSString *connectError) {
      if (connectError) {
        reject(@"PRINT_FAILED", connectError, nil);
        return;
      }
      self->_pending = data;
      self->_offset = 0;
      self->_waitingForReady = NO;
      self->_withResponse = !(self->_characteristic.properties & CBCharacteristicPropertyWriteWithoutResponse);
      self->_printResolve = resolve;
      self->_printReject = reject;
      [self pump];
    }];
  }];
}

- (void)pump
{
  if (!_printResolve) return;
  CBCharacteristicWriteType type =
      _withResponse ? CBCharacteristicWriteWithResponse : CBCharacteristicWriteWithoutResponse;
  NSUInteger maxLen = MIN([_peripheral maximumWriteValueLengthForType:type], KdsMaxChunk);
  if (maxLen == 0) maxLen = 20;

  if (_offset >= _pending.length) {
    [self finishPrint:nil];
    return;
  }
  if (!_withResponse && !_peripheral.canSendWriteWithoutResponse) {
    _waitingForReady = YES;
    return;
  }
  NSUInteger len = MIN(maxLen, _pending.length - _offset);
  NSData *chunk = [_pending subdataWithRange:NSMakeRange(_offset, len)];
  _offset += len;
  [_peripheral writeValue:chunk forCharacteristic:_characteristic type:type];
  if (_withResponse) return;

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, KdsChunkDelayMs * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    [self pump];
  });
}

- (void)peripheralIsReadyToSendWriteWithoutResponse:(CBPeripheral *)peripheral
{
  if (peripheral != _peripheral || _withResponse || !_waitingForReady) return;
  _waitingForReady = NO;
  [self pump];
}

- (void)peripheral:(CBPeripheral *)peripheral
    didWriteValueForCharacteristic:(CBCharacteristic *)characteristic
                             error:(NSError *)error
{
  if (peripheral != _peripheral || !_withResponse) return;
  if (error) {
    [self finishPrint:error.localizedDescription];
    return;
  }
  if (_offset >= _pending.length) {
    [self finishPrint:nil];
  } else {
    [self pump];
  }
}

- (void)finishPrint:(nullable NSString *)error
{
  RCTPromiseResolveBlock resolve = _printResolve;
  RCTPromiseRejectBlock reject = _printReject;
  _printResolve = nil;
  _printReject = nil;
  _pending = nil;
  if (!resolve) return;
  if (error) {
    reject(@"PRINT_FAILED", error, nil);
  } else {
    resolve(nil);
  }
}

@end
