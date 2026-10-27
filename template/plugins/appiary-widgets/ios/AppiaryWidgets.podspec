Pod::Spec.new do |s|
  s.name = 'AppiaryWidgets'
  s.version = '0.1.0'
  s.summary = 'appiary first-party capacitor plugin: home-screen widget data surface'
  s.homepage = 'https://appiary.dev'
  s.author = 'appiary'
  s.license = 'MIT'
  s.source = { path: '.' }
  s.ios.deployment_target = '13.0'
  s.swift_version = '5.1'
  s.source_files = 'Plugin/**/*.{swift,h,m,c}'
end
