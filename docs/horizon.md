# appiary horizon: versioned roadmap

positioning reminder: appiary is the customer's "mac in the cloud" for
browser-only builders (lovable, replit, base44) with no macs and no xcode.
one click on publish: we send their app data to the github actions api, an
ephemeral macos vm signs with their apple api keys, and the build lands on
testflight or the play console.

## v1 (now): capacitor webview wrap

- intake: web app url -> capacitor `server.url` injection -> native shell
- preview: vibeview streaming (appetize adapter retained)
- compile: repository_dispatch -> bitrise build hub mac runners
  (github-hosted macos-latest as fallback)
- submit: fastlane match / gym / deliver (ios) and supply (android)
- pricing: flat per upload, capped preview minutes (see cost-model.md)

known limitation: capacitor documents `server.url` as a live-reload option,
not for production, and apple's 4.2 "minimum functionality" review guideline
is the standing risk for thin webview wrappers. v1 ships anyway because the
wrap is instant and the customers' apps are full applications, not websites.

## next up (v1.x): mobile home-screen widgets

the next native surface after the parked v1 items (icon/splash,
dashboard): home-screen widgets on both platforms.

- **ios**: a widgetkit extension target added to the generated xcode
  project - timeline entries, per-app layout, refreshed by the
  system. **android**: appwidgets (remoteviews / glance) declared in
  the manifest with a homescreen provider.
- the hard part is data, not pixels: a widget must render while the
  webview is dead, so the bridge gains a surface
  (`appiary.widget.set` / shared app-group storage) that the web app
  writes on its own schedule and the native timeline reads.
- despia ships "home widgets" today, so this is parity-and-pass
  work: same feature class, plus our declared-at-intake wiring and
  the same honest docs treatment. sized as its own work item, not
  squeezed into the template as an afterthought.

## v2 (next native wrapper): react native / expo

- why second: the customers' source code is react (lovable/replit outputs).
  web react -> react native is a same-language translation: state logic,
  hooks, and types carry over; layout and navigation get rewritten.
- expo would add eas build/submit as an alternative orchestrator for this
  path. eas is flat per build (ios medium $2 / large $4, android medium $1 /
  large $2), which maps 1:1 onto our flat per-upload model.
- the vault, single-use handoff, and pipeline state machine are unchanged:
  only the wrapper layer (step 1) and possibly the build activity change.
- premium tier candidate: "true native" conversion at a higher flat price
  than the webview wrap, answering the 4.2 risk directly.

## v3 (way off, horizon only): flutter

- flutterflow is not a shortcut here: the builder is closed-source
  (verified 2026-10-20), so there is no engine to embed or self-host.
  the lane, if ever taken, targets flutter source directly; until
  then flutterflow apps arrive through v1 as web exports.
- explicitly the last rung, and far: nothing here is scheduled or designed yet. web react -> flutter is a language hop to dart
  where almost no source carries over; the intake layer becomes a
  conversion product, not a packaging product.
- serverpod stays out of appiary's scope: hosting customer dart backends is
  a different business. flutter-as-a-target is the boundary; a serverpod
  app is still "publish a flutter app" from our side.
- bitrise build hub is flutter-first by heritage, so the build cost model
  carries over unchanged.

## sequencing rule

each version adds a wrapper without rewriting the pipeline: preview,
credential routing, orchestration, and submission are wrapper-agnostic by
design. pick the next rung only when v1's review-risk signal (4.2 rejections)
or customer demand justifies it, not on the calendar.

## also parked at the same distance

- **desktop (tauri):** packaging web apps as desktop binaries is the same
  idea on another axis. interesting later; the intake layer already produces
  a buildable web source, so a tauri target would reuse steps 0 and the
  store logic, but desktop signing/notarization is a separate problem.
- **cli tools:** a programmatic appiary for terminal users.
- **desktop widgets (windows / macos):** home-screen widgets'
  desktop cousins (the windows 11 widget board, macos desktop
  widgets) - parked at the same distance as the desktop/tauri target
  itself; the mobile widget work designs the data surface so a
  desktop reader could reuse it, but no desktop widget code is
  scheduled.
- **amazon fire (asked 2026-10-20):** fire tablets are android -
  a new store channel (amazon appstore) in the same pattern as
  samsung, and our apk already runs there; cheap to add when a
  customer asks. **fire tv / fire stick** are technically possible
  (android tv builds with leanback + d-pad navigation) but a touch
  web app on a 10-foot ui is usually the wrong product - parked
  until a customer actually has a d-pad-friendly ui.
- **chromebooks:** free. chrome os runs play-store android apps
  natively, so the play channel already ships there, and the owner's
  web url already runs in the browser. the +tablets form-factor tier
  covers the large-screen layout question; nothing new to build.
- **kindle e-ink readers:** hard no, honestly: kindle e-readers do
  not run android apps at all (locked firmware, no third-party app
  platform). "kindle fire" tablets are the android ones - see the
  fire tablet lane above.
- **macos / watchos:** macos needs mac catalyst (different pipeline and
  signing story); watchos is not a capacitor target. both stay parked here. the pipeline is
  already a node library with a cli surface; a public cli is mostly auth and
  packaging work, not new architecture.

neither moves until v1 earns it.
