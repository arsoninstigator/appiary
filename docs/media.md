# media, realtime, and the always-on native surfaces

how appiary handles the app classes that want to be *alive*: chat,
calls, streaming, background music, split screen, biometrics,
bluetooth. the whole section turns on one boundary:

- **foreground**: the webview is a first-class engine (webkit on ios,
  chromium on android). websockets, webrtc, and video playback run on
  the same engine mobile browsers use. the shell adds no meaningful
  lag - realtime performance is a webview question, not a wrapper
  question.
- **background**: the os suspends the webview. foreground js stops,
  html5 media stops, and the microphone mutes (verified: azure
  communication docs for webview calling; wkwebview behavior since
  ios 14.3). everything below maps onto that line.

## real-time messaging

- foreground: plain websockets over the normal network stack. no
  wrapper overhead exists to remove.
- background: the webview is suspended, so delivery moves to push
  (the push lane) plus a silent resync when the app resumes. that is
  the correct chat pattern on mobile anyway - apps that expect a live
  socket in the background are fighting both operating systems.

## calls (voice/video)

- `getUserMedia` works inside the app webview: wkwebview supports it
  since ios 14.3 (wwdc21), and android webview grants it through
  capacitor's bridge once the permission catalog declares camera /
  microphone with their usage descriptions.
- webrtc calls run on the engine's stack - fine for normal call
  latency.
- honest limits: the **mic mutes when the app backgrounds** on both
  platforms, so a call must stay foregrounded; and `getDisplayMedia`
  (screen sharing) does not exist in wkwebview.

## twitch-style streaming

- foreground playback: hls/mse in a `<video>` element,
  hardware-decoded, and low-latency webrtc playback all work in the
  webview.
- honest limits: **drm (widevine/fairplay) is unsupported by us** -
  webview eme support is device-dependent and not a promise we can
  make to owners of protected catalogs. video in the background
  becomes the background-audio problem below. picture-in-picture is
  a native feature, not a webview one.

## background playback (music, video audio)

the honest no first: **plain html5 audio does not survive
backgrounding**. android suspends the webview renderer (android 17
hardens this further, requiring `while-in-use` foreground services),
and on ios html5 audio is at best fragile behind `UIBackgroundModes
audio` with no lock-screen controls.

the right pattern is a native audio service: ios background mode +
`AVAudioSession` playback category, android `MediaPlayback` foreground
service + media-session lock-screen controls, fed a stream url by the
web app. that is a **planned v2 capability** (`appiary.media`), not in
the box today - v1 intake should flag music apps so we can say this
with the quote screen, not after launch.

## split screen and picture-in-picture

- **android split screen / multi-window**: the shell is a normal
  activity and resizable by default on modern android, so the webview
  follows the window. per-app layout behavior is the owner's web css
  question.
- **picture-in-picture**: android pip is an activity feature and ios
  16.4+ has native pip - but entering pip from inside a webview needs
  native wiring we have not built. v2 item alongside the media
  service.
- **ipad multitasking** (slide over / split view): depends on the
  generated project's declared requirements; not gated by the shell,
  untested per-app.

## biometrics

face id / fingerprint as a login gate: passkeys and webauthn inside
the webview bind to the webview origin (`capacitor://localhost`), which
the passkey infrastructure rejects; the reliable pattern is a native
biometric prompt (plugin) that unlocks the app or session. not wired
in v1 - a v2 capability with the same shape as the permission
catalog: declared at intake, patched in at build time.

## bluetooth and sensors

**web bluetooth does not exist in android webview** (a long-open
chromium issue) or in wkwebview. ble wearables, heart-rate straps,
printers, and accessories need a native plugin - a v2 capability that
would also add the android 12+ `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`
permission pair to the catalog. device sensors that do have web apis
(motion, orientation, geolocation) work in the webview where the os
allows them.

## google drive as a backend

nothing special to wrap: it is oauth + rest. drive scopes ride the
oauth lane (system-browser handoff in bundle mode, provider-native
flows where they exist), and the "this app counts as a drive app"
registration lives in google's console, unaffected by the wrapper.
`drive.file` scope gives per-file access and works in both modes. the
only drive-shaped trap is calling drive a *backend*: it is rate-limited
storage, and a busy app should own its database.

## latency-critical and infra-heavy classes (v1 exclusions)

policy, not aspiration - these app classes are out for v1, and intake
should say so with the quote rather than after launch:

- **trading where one second is catastrophic**: out. the webview adds
  no measurable hop of its own, but this class needs sub-second
  end-to-end guarantees - native sockets, co-located execution,
  exchange-grade infrastructure - and a wrapper would be promising
  what it cannot measure.
- **crypto trading and mining**: out twice. the same latency
  reasoning, and on-device mining is banned by both stores outright
  (app store guidelines and google play policy both prohibit it), so
  wrapping it produces an app no store will take.
- **infra-heavy fintech platforms** (brokerages, neobanks, lending):
  out for v1. the wrapper wraps a web app; it does not become a
  regulated financial institution. if fintech fronts come later they
  arrive as licensed fronts talking to their own compliant backends,
  and even then the shell says what it is.

the v1 verdict for owners: casual and content-driven apps in; apps
whose promise is latency, execution, or regulation out.

## e-signature and cryptographic integrity

- **hosted signing ceremonies** (docusign, dropbox sign, embedded
  flows): work in the webview, and the tamper resistance is
  inherited, not weakened - the cryptographic sealing (the provider's
  certificate, the tamper-evident envelope, the audit trail) happens
  on the provider's servers. the wrapper is a viewport to their
  page, exactly like the web version, and the completed document's
  integrity checks are the provider's.
- **the honest webview risk**: the signing page itself could be
  shown doctored in transit or the origin spoofed. the shell's origin
  discipline covers the first layer (bundle mode ships one fixed
  origin; wrap mode is the owner's https origin), and
  **certificate pinning** on the signing session is the second layer
  - native work (urlsession delegate on ios, network security config
  on android), a v2 item for apps that need bank-grade assurance.
- **self-implemented signing**: a web app that signs documents
  itself in js is signing with soft keys in webview memory - fine
  for low-assurance flows, but not a tamper-resistance claim anyone
  should make to their customers. hardware-backed signing (ios
  secure enclave, android keystore - keys that never leave the
  device, attested to the server) is a native plugin away: a v2
  capability with the same declared-at-intake shape as the
  permission catalog.
- verdict: provider-hosted e-sign in v1 with inherited tamper
  evidence; hardware-backed self-signing and cert pinning as v2
  capabilities for apps that need to make the claim themselves.

## blocking screenshots

the honest split, because the two operating systems simply disagree:

- **android**: `FLAG_SECURE` on the activity window actually blocks
  screenshots, screen recording, and blanks the recents/system ui
  preview. one line in the main activity, patched at build time - the
  same injection pattern as the game services init. a v2 native-surface
  item (`screenshotBlock` capability), trivial to wire once intake
  wants it.
- **ios**: **there is no supported way to block a screenshot.** no
  private or public api prevents capture; even apple's own apps
  cannot. the only lever is detection (`userDidTakeScreenshot`
  notification) and reacting - blur the content, log the audit trail,
  warn the user. any vendor claiming screenshot *blocking* on ios is
  claiming something apple does not offer.

what we will say to owners: banking-style android-only blocking yes;
on ios we ship detection plus your reaction, and the doc says so
rather than pretending parity.
