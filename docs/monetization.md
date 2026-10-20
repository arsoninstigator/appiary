# monetization surfaces: ads and tier upsells

how appiary apps make money for their owners. two very different
mechanisms live in this question, with very different answers.

## in-app ads

the honest split first:

- **web display-ad networks (adsense-style) do not work in apps.**
  adsense's program policies exclude software applications, mobile
  ad networks have no programmatic demand for in-webview app
  inventory, and a webview ad slot is a policy rejection waiting to
  happen. we do not ship this and will not wire it.
- **mobile ad networks (admob and friends) are native sdks** - the
  ecosystem's capacitor plugin (@capacitor-community/admob, current
  at 8.2.1 and tracking capacitor 8) is alive, so unlike play games
  this needs no first-party plugin.

the wiring, when it lands as a v2 capability (`ads: admob` declared at
intake, the same declared-then-patched shape as every other native
surface):

1. the owner registers with admob, creates their app entries, and
   gets real ad unit ids; test ids run until store submission.
2. the build installs the ads plugin when the capability is declared
   and the bridge exposes `appiary.ads`: initialize (their app id),
   show banner / interstitial / rewarded, and a consent gate.
3. **the consent flow is not optional**: google's ump (user messaging
   platform) consent must run before ads show for eea/uk users, and
   both stores' review demand that ads never mimic ui or system
   dialogs. interstitials at natural breaks only - ad-heavy apps get
   rejected by both apple and google review.
4. revenue is entirely the owner's: their admob account, their
   payout, appiary takes nothing and sees nothing.

honest status: not wired in v1. it is listed at intake so owners
planning an ad-funded app hear the timing with the quote, not after
launch.

## upsell popups and tier upgrades (the owner's own tiers)

this one is already done, because it is their app's own ui:

- in-app upsell modals, paywalls, "upgrade to pro" prompts - plain
  web ui inside the webview. the shell adds nothing and blocks
  nothing; their web app does what it already does on the web.
- the thing being sold (pro tier, subscription, unlockable) rides
  the iap add-on lane, which exists as an app-level capability with
  store-native purchase flows - the upsell needs something to sell,
  which is the purchase lane's job, not the popup's.
- push-based upsell ("upgrade now" pushes) is technically trivial -
  the push lane plus their backend segmentation - and
  behaviorally a bad idea; silent upsell pushes earn uninstalls.
  recommend in-app prompts at real moments (usage limits hit,
  feature gated) and keep push for messages the user asked for.
- `appiary.permissions.state` and the other gating surfaces exist
  precisely so the upsell can be honest about what the free tier
  contains.

## what appiary itself takes

nothing from either surface. ads are the owner's network account;
upsells are the owner's iap lane. appiary's pricing is per build
push, stated at quote time, and never a cut of the owner's revenue.
