# changelog

## unreleased (v1.1)

- icon/splash generation service: a source square image (>=1024px)
  becomes the full asset tree at intake time - ios appiconset (all
  sizes + 1024 marketing icon), ios storyboard splash imageset,
  android launchers per density, adaptive layers (anydpi-v26 xml),
  android splash images per density. a separate service by design:
  builds install no image tooling, apply-runtime post only copies the
  staged `iconset/` tree into the generated platforms.
- dashboard: a dependency-free http surface over the real modules
  (src/dashboard/server.js + public/index.html, single file, no
  build step). intake (url wrap + zip bundle), icon generation per
  job, simulator preview (appetize publish from an artifact url),
  publish dispatch with platform + release track pickers, live job
  list. honest degradation: steps needing external keys answer 503
  with the exact missing env, never pretend.
- parked on the horizon (asked 2026-10-20): amazon fire tablets
  (android - a new store channel when asked), fire tv/stick (10-foot
  ui question, parked), chromebooks (already free via the play
  channel + the web), kindle e-ink (hard no - no app platform).

## v1.0.0 — 2026-10-20

first closed release: the browser-to-store pipeline.

shipped:
- intake: web urls (wrap), git repos (github/gitlab/bitbucket/gitea),
  zip uploads (bundle). bundle mode ships assets in the binary —
  review-safe, offline on airplane mode.
- preview: simulator streaming (appetize adapter), embedded iframe.
- compile: repository_dispatch -> ephemeral runners; android verified
  end to end on a disposable linux vm (real apk), ios on a managed
  m4 mac runner (real xcodebuild, spm template). node 22, capacitor 8.
- sign + submit: fastlane match/gym/deliver + supply; release tracks
  (test users vs production, staged rollout, version history incl.
  test releases); per-channel identity and update machinery.
- credentials: envelope-encrypted vault, single-use handoff tokens,
  shredded post-build. keys never travel in dispatch payloads.
- device bridge: push + in-app notifications, normalized permission
  states, per-channel gating, direct-channel update check, haptics,
  orientation, screen-reader detection, local-time streaks.
- game services: first-party plugin (play games v2 / game center),
  both halves compile-verified on real machines.
- deep links: the appId is a registered url scheme on both platforms
  (CFBundleURLTypes + browsable VIEW intent-filter), idempotently.
- docs: the honest set — games, media/realtime/native surfaces,
  monetization, audience/privacy, compare, cost model, credential
  flow, distribution channels, horizon. every verdict dated.

deferred (see horizon):
- icon/splash generation service (v1.1)
- dashboard ui (v1.1)
- mobile home-screen widgets (next work item, v1.x)
- native-only v2 surfaces: background media service, biometric
  unlock, screenshotBlock, ads, exif helper, cert pinning.

31/31 self-tests green at tag time.
