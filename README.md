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

1. **client runtime wrapper** — a native project template built with
   [capacitor](https://capacitorjs.com). wrap mode streams a live
   web url; bundle mode ships the app's assets inside the binary
   (review-safe, and the app works offline). see `src/wrapper.js`
   and `template/`.
2. **interactive browser preview** — a headless build pushed to a
   simulator streaming service ([appetize.io](https://appetize.io)),
   embedded in the dashboard. see `src/appetize.js`.
3. **cloud compilation** — no mac minis. publish triggers a
   `repository_dispatch`; an ephemeral hosted macos runner compiles
   on demand. see `src/github.js` and `.github/workflows/appiary-build.yml`.
4. **automated signing and submission** — fastlane inside the runner:
   `match` (provisioning), `gym` (binary), `deliver`/`supply` (store
   upload, with release tracks for test users vs production). see
   `template/fastlane/Fastfile`.

## why it is not just another wrapper

- **your credentials stay yours.** store keys live in an
  envelope-encrypted vault, are released to a build through a
  single-use handoff token, redeemed once inside the ephemeral
  runner, and shredded when the job ends. secrets never sit in a
  vendor dashboard. see `docs/credential-flow.md`.
- **no lock-in, structurally.** the pipeline is standard capacitor +
  fastlane + github actions, and the whole native template is in the
  repo. you can take it and build anywhere; there is nothing
  proprietary to escape from.
- **store-rule correctness as a feature.** digital goods route
  through store-native purchases (apple 3.1.1), release tracks route
  test users vs production users through the stores' own beta
  machinery, and the docs say no where no is the honest answer. see
   docs/distribution-channels.md.
- **priced like infrastructure, not like a moonshot.** per push,
  usage-based, no subscriptions: ios push $48.99, android push
  $28.99, both platforms $77.98. wrap-mode content edits are free.
  the margin math is public in docs/cost-model.md.

for the honest competitive picture against despia and the generic
converters, see docs/compare.md.

## layout

```
appiary/
  src/
    index.js          cli entry (wrap / deploy)
    config.js         env config
    log.js            lowercase logger with credential scrubbing
    wrapper.js        step 1: capacitor config injection
    appetize.js       step 2: simulator preview client
    github.js         step 3: repository dispatch orchestration
    pipeline.js       job state machine: wrapped -> previewing -> dispatched -> building -> submitted
    vault.js           credential vault + single-use handoff tokens
    vault/crypto.js   envelope encryption primitives
    handoff-server.js the two-route api the runner talks to
    store.js          pluggable kv store (swap for the app database)
  template/           hidden capacitor native project template + fastlane lanes
  .github/workflows/  the runner-side build workflow
  tests/selftest.js   self-test suite (no network needed)
  docs/               architecture, credential flow, and the honest docs
```

## usage

```sh
# wrap a web app
APPIARY_MASTER_KEY=... node src/index.js wrap \
  --url https://demo.lovable.app \
  --app-id com.example.demo \
  --app-name "Demo App"

# dispatch a cloud compile (needs github repo + token)
APPIARY_GITHUB_TOKEN=... APPIARY_GITHUB_REPO=appiary/cloud \
APPIARY_MASTER_KEY=... node src/index.js deploy \
  --job job-....json --credentials creds.json --platform ios

# self-tests
npm test
```

## intake

three ways in: published web urls (wrap), git repos on
github/gitlab/bitbucket/gitea (bundle), or zip uploads (bundle). see
docs/architecture.md, step 0. once shipped, the app's device behavior
(notifications, permission states, accessibility) is documented in
docs/device-runtime.md and its stores and update channels in
docs/distribution-channels.md. whether a game can ship on the shell
has its own honest verdict in docs/games.md, ads and tier upsells
are covered in docs/monetization.md, and audience gating (18+, kids)
and the privacy surface in docs/audience-privacy.md.

## roadmap

see `docs/horizon.md` for the versioned plan: v1 capacitor wrap (now),
v2 react native / expo, v3 flutter late stage on the horizon.

## status

working core, compile-verified on real machines: both halves of the
native pipeline (android on a disposable linux vm, ios on a managed
mac runner) produce real binaries end to end. the dashboard ui and
the icon/splash service are the next layer.

## pricing

per push, usage-based, no subscriptions. ios push $48.99, android
push $28.99, both platforms $77.98. a push is any pipeline run that
produces a new store artifact — first build and updates cost the
same, wrap-mode content edits are free (they never rebuild).
previews are bundled with hard minute caps. see docs/cost-model.md
for the margin math and docs/compare.md for how this stacks up
against the alternatives.
