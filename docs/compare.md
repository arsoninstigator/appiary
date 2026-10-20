# compare: appiary vs the alternatives

verified against despia's public site on 2026-10-20 and against what
each tool's own docs claim. features change; this page dates itself
rather than pretending to be eternal.

## the field

- **despia** (despia.com) — the closest direct competitor. web app to
  native converter, one-time packs, real native feature list, an mcp
  server, and over-the-air updates.
- **generic web-to-app converters** (webviewgold, median.co, and the
  long tail) — url in, webview app out, hosted or self-hosted
  licenses; store submission is mostly your problem.
- **doing it yourself** (react native / expo, or hiring native devs)
  — the honest baseline. full control, full cost: a mac, accounts,
  signing, review knowledge, and an engineer's time.

## the comparison that matters

| | appiary | despia | generic converters | diy |
|---|---|---|---|---|
| pricing model | per push, usage-based ($68.69 both platforms to start) | one-time packs ($249 solo / $498 hybrid) | one-time license, tiered | salaried time + infra |
| credential custody | yours: envelope-encrypted vault, single-use handoff, shredded post-build | their platform manages the build | varies; often license-key based | yours, manually |
| escape hatch | standard capacitor + fastlane + github actions; the whole template is in the repo, self-hostable from day one | source code export on the pack | a codebase you can edit | nothing to escape |
| store-rule lanes | built in: 3.1.1-compliant purchase routing, release tracks, kids/18+ verdicts, review-safe bundle mode | compliant build, revenuecat + storekit paywalls shipped | mostly your problem | your problem |
| honest "no"s | documented (drm, background html5 audio, ios screenshot blocking, trading apps) | feature list is the pitch | thin docs | n/a |
| update model | rebuild per native change (minutes); content edits free in wrap mode | ota updates: push fixes in seconds, no approval wait | varies | whatever you build |
| offline support | structural: bundle mode compiles assets into the binary - airplane mode on day 1; wrap mode online by definition, docs say so | "offline apps" listed on their site; mechanics not documented publicly | varies | yours |
| privacy surface | documented: the shell collects nothing; exif guidance is honest (we do not scrub today - server-side strip recommended, v2 helper planned); kids/18+ lanes pinned | "privacy compliance" listed; no public privacy-surface documentation found | thin docs | yours |
| native breadth today | push, notifications, permissions, game services (compile-verified), haptics, orientation, screen-reader detection | broader shipped list: biometrics, siri shortcuts, widgets, admob, onesignal | limited | unlimited |
| mcp / api surface | planned | mcp server now, platform api by quote | n/a | n/a |

## the honest ledger

**where despia wins today:** update speed (their ota lane pushes
fixes in seconds against our minutes-long rebuild), shipped native
breadth (their feature list includes things we have honestly parked
as v2: biometric prompts, siri shortcuts, widgets, ads), the mcp
server, and market maturity. they also publish their compute cost
and margin per pack - a good-faith move we respect.

**where appiary wins structurally:**

1. **credential custody.** our model never holds your store keys in
   a dashboard. keys sit in an envelope-encrypted vault, reach a
   build through a single-use handoff token, and die with the job.
   despia's value prop includes managing the build for you, which
   means trusting their custody. this is an architectural choice,
   not a feature - and it cannot be bolted on later.
2. **no lock-in as a first property.** despia markets "no vendor
   lock-in" via source export on their paid packs. we start from a
   stronger place: the pipeline is the boring standard stack
   (capacitor, fastlane, github actions) and the template lives in
   the repo you can walk away with. there is nothing to export
   because nothing is withheld.
3. **per-push economics.** $249 buys one app's conversion once; a
   browser-only builder with three experiments pays before knowing
   any of them will stick. our $68.69 both-platform bundle prices
   the first experiment like an experiment, and updates cost only
   when a native artifact must change - with form-factor tiers
   (ipados, tablets) priced as add-ons, not baked into the base.
4. **the release-track machinery.** test users vs production users
   through the stores' own beta surfaces, staged rollouts, version
   history including test releases, country-limited rollouts (the
   bondee pattern, per-track) - the stuff a serious app needs on
   day 30, not day 1. despia's country-rollout story is unverified:
   it is not in their public feature list as of 2026-10-20.
5. **the honesty culture.** the docs say no in writing - drm,
   background audio, ios screenshot blocking, latency-critical apps,
   "we do not scrub exif today" - before the customer pays, not
   after the first rejection. competitors publish feature lists; we
   publish the seams too. for a
   buyer who cannot evaluate native claims, that is the moat that
   compounds: every honest no is a reason to believe the yeses.

**where the generic converters sit:** cheaper than both of us,
thinner than both of us. fine for a hobby webview; wrong for anyone
who cares about review outcomes.

**where diy sits:** nothing here competes with a team that already
owns a mac, a pipeline, and store accounts. appiary is for the
builder who does not have any of the three and never wants to.

## the one-line version

despia sells a better wrapper; appiary sells custody, freedom, and
the truth - at usage-based prices. competitors can copy a feature
list; they cannot retroactively stop holding your keys.
