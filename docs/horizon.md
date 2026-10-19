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

## v3 (late stage, horizon only): flutter

- explicitly the last rung. web react -> flutter is a language hop to dart
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
