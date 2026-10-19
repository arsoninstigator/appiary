# distribution channels and updates

where builds ship, how end users get updates, and how one app can carry
different features per store (the noteshelf pattern).

## channels

| channel | platform | how end users get updates |
|---|---|---|
| appstore (default) | ios only | the app store auto-updates; testflight builds auto-update too |
| play (default) | android | play store auto-updates (respecting the user's store setting) |
| samsung | android | galaxy store auto-update, on by default in galaxy store settings |
| direct | android | nothing auto-updates: the app checks the owner's endpoint itself |

a channel is chosen per push, so one app can ship to play and samsung as
two builds of the same source. each channel push is its own pipeline run
and its own store artifact, so per-push pricing applies per channel.

## the shared-identity rule

same appId plus same signing key across android channels means a galaxy
store update upgrades a play-installed app and vice versa: one app, two
stores, users never see the difference. diverging the appId per channel
(per-channel `channel.appId` at intake) gives side-by-side installs: a
samsung build and a play build coexist on one device. pick per app; do not
accidentally get both.

## per-store features (noteshelf-style)

the channel is baked into the binary and exposed as `window.appiary.channel`
(the same constant outside the shell is `'web'`). feature gating is then a
plain branch in the owner's web code:

```js
if (window.appiary.channel === 'samsung') {
  // enable the s-pen experience, samsung-only promos, galaxy-specific upsell
}
```

store-specific native sdks (s pen sdk, samsung checkout) are declared per
channel at intake and injected as conditional dependencies during the
pre-sync phase, the same mechanism that adds camera/geolocation plugins.
the noteshelf approach - a samsung build that feels richer than the play
build - is exactly this branch plus the conditional dep.

## direct-channel updates (sideloaded apks)

when users install from anywhere that is not a store, updates are ours to
handle:

1. the owner sets `channel: { name: 'direct', updateCheckUrl }` at intake.
2. the build injects `android.permission.REQUEST_INSTALL_PACKAGES` and bakes
   the endpoint and the build number (github run number, monotonic) into the
   bridge.
3. the web app calls `appiary.updates.check()` at launch (and whenever it
   likes); it fetches the owner's endpoint, which returns
   `{ buildNumber, url, note }`, and reports `{ available, buildNumber,
   url, note }`.
4. the owner's ui decides the pitch; the url can be an apk (the install
   permission covers it) or a store listing. appiary does not force an
   update flow - it is their app and their users.

ios has no direct channel: apple distribution is the app store, testflight,
or enterprise programs the owner runs entirely on their own. we say so
instead of pretending.

## what is deliberately not here

ota web-asset hotpatching stays parked at v2: store builds update by
rebuild (minutes), direct builds update by check+download, and hotpatches
cannot ship native changes anyway. when it ships it will ride the same
build-number monotonicity, so nothing about this design changes under it.
