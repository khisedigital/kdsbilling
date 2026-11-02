Pod::Spec.new do |s|
  s.name         = 'KdsPrint'
  s.version      = '1.0.0'
  s.summary      = 'KDSPOZ printing: BLE and Wi-Fi / LAN (ESC/POS) thermal printers'
  s.homepage     = 'https://khisedigital.info'
  s.license      = { :type => 'Proprietary' }
  s.author       = 'Khise Digital Solution'
  s.platforms    = { :ios => '15.1' }
  s.source       = { :path => '.' }
  s.source_files = '*.{h,m}'
  s.frameworks   = 'UIKit', 'CoreBluetooth'
  s.dependency 'React-Core'
end
