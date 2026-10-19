Pod::Spec.new do |s|
  s.name = 'AppiaryGameServices'
  s.version = '0.1.0'
  s.summary = 'appiary game center surface (ios half of the gameServices capability)'
  s.license = { :type => 'MIT' }
  s.homepage = 'https://appiary.dev'
  s.author = { 'appiary' => 'hey@appiary.dev' }
  s.source = { :git => 'https://github.com/tinkerquest/appiary', :tag => s.version.to_s }
  s.source_files = 'Plugin/**/*.swift'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
  s.ios.deployment_target = '14.0'
end
