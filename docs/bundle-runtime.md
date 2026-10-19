# bundle mode at runtime: api calls, oauth, payments

bundle mode loads assets from the device, so the webview origin is
`capacitor://localhost` (ios) or `https://localhost` (android, androidScheme
https). this doc maps every class of web call to how it behaves and what the
app's owner configures. three lanes, one rule each.

## lane 1: plain api calls (data, your own backend)

work as-is. `fetch` to supabase, insforge, firebase, or a custom backend is a
normal https request; the origin only matters for cors.

- the backend allowlists both webview origins (`capacitor://localhost` and
  `https://localhost`). supabase: dashboard -> url configuration -> additional
  redirect urls / cors. custom backends: one line in the cors config.
- prefer token auth (authorization header, supabase access token) over cookie
  sessions. ios webviews apply cookie restrictions that break silent session
  refresh; bearer tokens sidestep the whole problem.

nothing about bundle mode changes the user's api layer otherwise.

## lane 2: oauth sign-in flows

redirect-based flows need an https origin, which the bundle webview does not
have. the standard shapes:

- **provider-native capacitor flows.** supabase-js detects capacitor and
  completes the flow with a custom-scheme redirect
  (`capacitor://localhost`); the user adds that exact string to their
  supabase url configuration. firebase documents the same custom-scheme
  pattern. insforge (postgrest-style) follows the same shape with pkce.
- **system-browser handoff.** the shell ships `@capacitor/browser`: the flow
  opens in the system browser (real https origin), and the callback returns
  through the app scheme. the code-for-token exchange afterwards is a plain
  https post from the webview, so no origin pinning applies.

verified against the capacitor config docs: the webview schemes are
`server.iosScheme` (default `capacitor`) and `server.androidScheme` (default
`https`, must stay `https` — custom schemes break query params on chrome
117+). we keep both at their defaults so every user allowlists the same two
canonical origins instead of per-app strings.

the oauth callback scheme is the appId itself (reverse-dns is a valid scheme,
unique per app, zero derivation). remaining template task: register it in
the generated platforms during `init-platforms.sh` —
`/usr/libexec/plistbuddy` adding CFBundleURLTypes on ios and an intent-filter
in the android manifest. the dashboard then shows users the exact callback
string (`<appId>://`) for their provider config.

rule: the login dance happens where an https origin exists (system browser,
or provider support for the capacitor scheme), and everything after the
token is lane 1.

## lane 3: money

two different jobs, and the split is forced by the app stores:

- **digital goods (premium tiers, unlocks, subscriptions consumed in the
  app): must go through in-app purchase.** apple guideline 3.1.1 and the
  play billing rules require it; routing digital purchases through stripe
  inside an ios app gets the app rejected. this is the revenuecat add-on:
  the official capacitor plugin runs purchases natively (storekit 2 / play
  billing) with the user's public sdk keys compiled into the shell, the
  webview reads entitlements through the js bridge, and the user's backend
  verifies via revenuecat webhooks. no webview origin is involved at all,
  so bundle mode changes nothing here.
- **real-world payments (physical goods, bookings, marketplace payouts):
  normal web payments.** the safe shape is stripe checkout (hosted page):
  the webview opens the checkout url, the user pays on stripe's domain, and
  the return url bounces back through the app scheme. same handoff pattern
  as oauth. embedding stripe payment elements directly in the webview works
  for simple cards but 3ds challenge windows and apple pay (needs associated
  domains) get flaky, so the dashboard should recommend hosted checkout for
  bundle mode.

rule: digital -> revenuecat/native iap, real-world -> hosted stripe checkout,
never stripe for digital on ios.

## summary for the dashboard

| call | works in bundle mode? | user config |
| --- | --- | --- |
| data api calls | yes | cors allowlist for both webview origins, token auth |
| oauth | yes, via scheme | add the capacitor scheme to provider url config |
| digital iap | yes, native lane | revenuecat sdk keys (premium add-on) |
| stripe (physical) | yes, hosted checkout | return url = app scheme |
