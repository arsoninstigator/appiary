# appiary cost model: choosing tools for flat per-upload pricing

checked against vendor pricing pages and published rate tables on 2026-10-19.
all prices usd. goal: keep our variable cost per upload low and *predictable*
enough to support flat charges per upload.

## tl;dr decision

| pipeline step | tool chosen | variable cost per upload | why |
|---|---|---|---|
| wrap (capacitor) | capacitor | $0 | oss |
| preview (streaming) | vibeview (starter plan) with appetize adapter kept | ~$0.16 per 10-min preview | $0.02/min metered, 3x cheaper than appetize, no 3-minute session cap |
| compile (ios) | bitrise build hub runners on our existing github workflow | ~$0.10-0.30 per ios build | ~$0.0072-0.0144/min vs github-hosted macos at $0.08/min, and ~2x faster hardware |
| compile (android) | linux runner (github or bitrise) | ~$0.04-0.08 per build | linux minutes are cheap everywhere |
| sign + submit (fastlane) | fastlane | $0 | oss |

modeled blended variable cost: **under $0.50 per upload** (one build + one 10-minute
preview, both platforms). that leaves generous margin for a flat fee like
$5-9 per upload, with the main discipline being hard caps on preview minutes.

## the pricing landscape we checked

### device streaming (step 2)

- **appetize.io** (current stack): free tier 2 devices / 30 min/mo / 3-minute session
  cap. starter $59/mo: 3 concurrent devices, 500 min included, then **$0.06/min**.
  premium $319/mo. enterprise offers self-hosting. premium saas rates: yes.
- **vibeview** (chosen default): free tier 2 sessions / 30 min/mo. dev $19/mo:
  2 sessions, 1,000 min included, overage **$0.02/min**, no session-length cap.
  starter $49/mo: 4 sessions, 3,000 min included ($0.016/min effective), plus
  embed-on-your-site for 1 domain, which is exactly the appiary dashboard case.
  professional $249/mo: 10 sessions, 20,000 min.
- **limrun** (yc p26): ios simulator streaming at 2 credits/min; $0.08/min at
  the included-allowance rate, $0.10-0.12/min at overage, plus a $20/mo entry
  subscription. aimed at ai agent sandboxes, premium for our use.
- self-hosting: android emulators can stream from a linux vps via oss device
  streaming projects, but ios simulators need real mac hardware, which violates
  the core "no mac infrastructure" constraint. revisit only if streaming
  becomes the dominant cost.

decision: **vibeview starter ($49/mo)** as the preview default. our appetize
client stays in the codebase as an adapter (same upload -> publicKey -> embed
url surface), so enterprise customers who want appetize-specific features can
be routed per project.

### cloud compilation (step 3)

- **github actions, private repo, hosted runners** (current stack):
  **macos $0.08/min**, linux $0.008/min, windows $0.016/min. a typical ios
  gym+match+deliver job runs 20-30 min => $1.60-2.40 per ios build.
  note: public repos get free minutes, but repository_dispatch client_payload
  is visible on public workflow runs, which would expose the single-use handoff
  token to a redeem race. the build repo must stay private.
- **bitrise build hub**: managed mac/linux runners that execute github actions
  workflows via `runs-on: bitrise-*` labels, no workflow rewrite. published
  machine rates (billed as "zero-margin pass-through"):
  macos medium (m4/m2 pro) **$0.0072/min**, macos large **$0.0096/min**,
  macos 4large (m4 pro large) **$0.0144/min**, linux m **$0.0044/min**.
  self-serve starts around $15/mo. their published benchmark: 2m04s vs
  github-hosted 4m28s on the same xcode compile. an ios build that costs
  $1.60-2.40 on github-hosted macos costs roughly **$0.10-0.30** here, at
  twice the speed. caveat: these rates were re-verified via published tables
  (sept 2026, confirmed with the vendor by an independent pricing tracker);
  re-verify in the console at signup before locking pricing.
- **bitrise ci platform** (the older product): starter $99-299/mo and pro from
  $218/mo tiers. not needed; build hub gives us the runners only, which is
  all appiary wants from it.
- **limrun**: xcode at $0.08/min active (allowance rate) with $20/mo minimum;
  ~5-8x more expensive than build hub for pure build work.
- **codemagic / bitrise ci / eas (for the future react native/expo path)**:
  codemagic ~$0.095/min macos plus subscriptions: premium. **eas build is
  notable: flat per-build pricing (ios medium $2 / large $4, android medium
  $1 / large $2)**, which maps 1:1 onto our flat-per-upload model if the
  react native/expo wrapper happens.

decision: **bitrise build hub mac runners**, invoked from the exact same
repository_dispatch workflow (runner label is configurable per dispatch;
github-hosted `macos-latest` remains the fallback). no vendor lock on the
orchestration: if build hub pricing changes, we flip the runner label back.

## flat-fee risk register

1. **preview minutes are the margin killer.** streaming is the only step with
   per-minute cost that scales with user behavior. mitigate: flat fee includes
   a fixed preview allowance (e.g. 30 min per upload), enforced by the
   dashboard via session time limits on the provider side (appetize `timeout`
   param, vibeview session limits). never ship uncapped preview streaming.
2. **build minute overruns.** a hung xcode job bills until timeout. the
   workflow already has `timeout-minutes: 60`; tighten to 45 for ios.
   gym's `clean: true` keeps builds deterministic but slower; cache-friendly
   native deps (cocoapods) via actions/cache if builds trend over 25 min.
3. **public repo free minutes are a trap** (see above): private repo only.
4. **first play upload per app is manual** (fastlane/fastlane#14686): bake a
   one-time onboarding step into the flat fee's cost expectations; it uses no
   runner minutes but does need support labor.
5. **plan minimums:** vibeview starter $49/mo + build hub ~$15/mo + private
   repo actions = roughly $65-100/mo fixed before any usage. break-even at
   ~15-20 uploads/mo on a $5 flat fee; everything after is margin.

## sources

- appetize.io/pricing (read 2026-10-19)
- vibeview.io/pricing (read 2026-10-19)
- limrun.com/pricing (read 2026-10-19)
- bitrise.io/pricing and bitrise.io/platform/build-hub (read 2026-10-19)
- independent rate-table verification: cicdcalculator.com/bitrise-pricing-mobile-ci
  (re-checked 2026-10-04; vendor-confirmed 2026-08-04)
- github actions per-minute rates: linux $0.008 / windows $0.016 / macos $0.08
  (long-standing published rates, re-confirmed 2026-10-19)
- eas build per-build pricing: expo.dev/pricing and docs.expo.dev usage-based
  pricing (read 2026-10-19)
