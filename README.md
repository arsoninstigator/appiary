# appiary

## the problem

ai app builders (lovable, base44, rork, a0.dev, replit, and the rest)
made it possible for anyone to build a working web app in an
afternoon. then the app happens: an app store listing is where real
users, real distribution, and real revenue live - and getting there
means a native binary, which means a mac, xcode, signing
certificates, provisioning profiles, apple and google developer
accounts, store review rules, and a build toolchain that fails in
ways a browser-only builder has never seen.

that gap - "my app runs in a browser" to "my app is on the app
store" - is the problem appiary exists to close. the people hitting
it are not native developers and do not want to become them. and the
existing shortcuts either charge one large fee up front while holding
your keys in their dashboards, or hand you a wrapped webview and let
apple's review surprise you.

## the solution

appiary is a middle saas layer that turns web apps into signed,
store-ready ios and android binaries - the mac in the cloud, plus the
store-rule knowledge. bring a url, a git repo, or a zip; get a live
simulator preview in your browser; click publish and an ephemeral
cloud mac compiles, signs with your own store credentials, and
submits to testflight or the play console. no mac hardware, no
certificates learned, no store-review surprises: what the stores
require (and what they reject) is built into the pipeline and
documented honestly, including where the answer is "no".

four moving parts:

- **client runtime wrapper** - a native project template built with
  [capacitor](https://capacitorjs.com). wrap mode streams a live web
  url; bundle mode ships the app's assets inside the binary
  (review-safe, and the app works offline). see
  [wrapper.js](src/wrapper.js) and the [template](template/).
- **interactive browser preview** - a headless build pushed to a
  simulator streaming service
  ([appetize.io](https://appetize.io)), embedded in the dashboard.
  see [appetize.js](src/appetize.js).
- **cloud compilation** - no mac minis. publish triggers a
  repository_dispatch; an ephemeral hosted macos runner compiles on
  demand. see [github.js](src/github.js) and the
  [build workflow](.github/workflows/appiary-build.yml).
- **automated signing and submission** - fastlane inside the runner:
  match (provisioning), gym (binary), deliver/supply (store upload,
  with release tracks for test users vs production). see the
  [fastfile](template/fastlane/Fastfile).

## why it is not just another wrapper

- **your credentials stay yours.** store keys live in an
  envelope-encrypted vault, are released to a build through a
  single-use handoff token, redeemed once inside the ephemeral
  runner, and shredded when the job ends. secrets never sit in a
  vendor dashboard. see the
  [credential flow](docs/credential-flow.md).
- **no lock-in, structurally.** the pipeline is standard capacitor +
  fastlane + github actions, and the whole native template is in the
  repo. you can take it and build anywhere; there is nothing
  proprietary to escape from.
- **store-rule correctness as a feature.** digital goods route
  through store-native purchases (apple 3.1.1), release tracks route
  test users vs production users through the stores' own beta
  machinery, and the docs say no where no is the honest answer. see
  the [distribution channels](docs/distribution-channels.md).
- **priced like infrastructure, not like a moonshot.** per push,
  usage-based, no subscriptions - details in the pricing section
  below, the margin math in the
  [cost model](docs/cost-model.md).

for the honest competitive picture against despia and the generic
converters, see [compare.md](docs/compare.md).

## intake

- **web urls (wrap mode)** - any published https url; known builder
  hosts (lovable, replit, base44, bolt.new, rork, a0.dev, and common
  static hosts) are labeled in the dashboard.
- **git repos (bundle mode)** - github, gitlab, bitbucket, gitea.
- **zip uploads (bundle mode)** - including workspace exports from
  sister extraction tooling.

details in the [architecture doc](docs/architecture.md), step 0.

## what ships with a v1 app

- the device bridge: push + in-app notifications, permission states,
  per-channel gating, haptics, orientation, screen-reader detection -
  [device runtime](docs/device-runtime.md).
- stores and update channels: app store, play, samsung galaxy store,
  direct - with release tracks, staged rollouts, country-limited
  rollouts, and version history including test releases -
  [distribution channels](docs/distribution-channels.md).
- games: the first-party game services plugin (play games v2 / game
  center), both halves compile-verified on real machines - the
  [games doc](docs/games.md) with the honest verdicts.
- ads, tier upsells, and what appiary never takes a cut of -
  [monetization](docs/monetization.md).
- audience gating (18+, kids), the privacy surface, and exif
  guidance - [audience and privacy](docs/audience-privacy.md).
- media, realtime, and the native-only surface - [media](docs/media.md).

## roadmap

- **v1.0.0 (shipped)** - the browser-to-store pipeline: wrap,
  preview, compile, sign, submit, credential vault, device bridge,
  game services, deep-link schemes. see the
  [changelog](CHANGELOG.md) and the
  [v1 tag](https://github.com/tinkerquest/appiary/releases/tag/v1.0.0).
- **v1.1** - icon/splash generation service and dashboard ui (in
  progress - [changelog](CHANGELOG.md)).
- **v1.x** - mobile home-screen widgets (ios widgetkit + android
  appwidgets, with an `appiary.widget.set` data surface).
- **v2** - react native / expo as a second wrapper, answering apple's
  4.2 webview-rejection risk with a true-native conversion tier.
- **parked on the horizon** - flutter (last rung, language hop);
  desktop (tauri); desktop widgets (windows/macos); cli tools. see
  [horizon.md](docs/horizon.md).

## closed beta release: free to test, run on your own tenki.cloud

appiary is in closed beta, and during beta it is **free to test** -
and it runs on **your own tenki.cloud account**, not ours:

- the pipeline is ordinary github actions plus fastlane plus
  capacitor; nothing in it needs appiary-owned build infrastructure.
- connect your own tenki runners (macos for ios builds, linux for
  android verification) and the exact workflow files in this repo do
  the building. your tenki usage is billed to your tenki account at
  their published rates; appiary takes nothing during beta.
- your store credentials, your repo, your runners: the beta period is
  also the proof of the no-lock-in claim - you are running the whole
  thing on accounts you own.

## pricing

at general availability: per push, usage-based, no subscriptions.

- ios push: **$48.69** (iphone) / **$58.69** (iphone + ipados)
- android push: **$28.69** (phone) / **$36.89** (phone + tablets)
- both platforms, same app: **$68.69** (bundle, phones) /
  **$86.89** (all form factors)

a push is any pipeline run that produces a new store artifact -
first build and updates cost the same, and wrap-mode content edits
are free (they never rebuild). previews are bundled with hard minute
caps. the margin math is public in the
[cost model](docs/cost-model.md), and the comparison against the
alternatives is in [compare.md](docs/compare.md).
