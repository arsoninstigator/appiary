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

## country-limited rollouts (the bondee pattern)

apps that launch only in some countries are a store-console control,
not a build-time one: the same binary, made available only where the
owner chooses.

- **play**: country availability is set per track in the play console
  (a beta can live in three countries while production waits). our
  per-track story composes: a `closed` track limited to the launch
  markets, promoted to `production` with the same country list.
- **app store**: availability is per-storefront in app store connect;
  apple's version territories are the equivalent knob.
- **v1**: the owner sets the country list in the console at first
  submission - the same manual console moment as the privacy policy.
  **v2**: both consoles expose the knob through their publishing apis
  (play track releases carry country targeting; asc has version
  territories), so a `countries` list at intake lands in the same
  automation lane as icons and metadata.
- the honest limit: local legal requirements for a given market are
  the owner's to know; appiary can gate the build but cannot license
  it.

## what is deliberately not here

ota web-asset hotpatching stays parked at v2: store builds update by
rebuild (minutes), direct builds update by check+download, and hotpatches
cannot ship native changes anyway. when it ships it will ride the same
build-number monotonicity, so nothing about this design changes under it.

## release tracks: test users vs regular users

a track is chosen per push (`releaseTrack` at intake) and the store's own
beta machinery routes users - we ship to the surface, the surface finds
the audience. competitors that wrap-and-forget do not do this at all.

| track | platform | who gets the build |
|---|---|---|
| testflight (default) | ios | internal groups (up to 100 per group) + external testers invited by email |
| appstore | ios | all app store users, after review (the push submits for review) |
| internal (default) | android | up to 100 internal testers in the play console |
| closed | android | closed beta: email list / google group admission |
| open | android | open beta: anyone can join from the play listing |
| production | android | all play users, optionally a staged rollout fraction |

the mechanics, for owners who ask "how do my testers get betas":

- **play**: testers opt into the beta program on the app's play listing (or
  the owner adds their email to the closed list). the store then
  auto-updates exactly those users to the beta build; production users
  keep getting production builds. promotion closed -> open -> production
  is a play console action (or simply push the same build to the next
  track).
- **ios**: testflight distribution by email; app store production stays
  untouched until an explicit `appstore` push submits for review.
- **what makes this safe**: build numbers are monotonic (github run
  number), so a beta build is always strictly newer than what any
  production user has, and no store ever offers a beta to the wrong
  audience.

**staged rollouts**: a production push can set `rollout` (e.g. `0.25`)
so 25% of users get the update first; the owner promotes 100% from the
console after watching crash rates. rollout only applies to production,
validated pre-build.

**version history, including test releases**: every push - production
or test track - is one monotonic build number, and the stores keep
their own history per track (testflight build history in app store
connect, per-track version history in the play console). nothing is
ephemeral from the store's perspective: a testflight or internal-track
release is a real, addressable version with its own row, and the build
number is the spine that ties dashboard history to both consoles. our
own bookkeeping keeps the run number alongside the push record so the
history survives even the deletion of a build from a track.

each track push is its own pipeline run and store artifact, priced per
push.
