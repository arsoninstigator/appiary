# device runtime: notifications, permissions, accessibility

how a shipped appiary app behaves on an end user's device, and what our
users (the app owners) control. the surfaces here are the appiary bridge:
`window.appiary`, staged into the app's web assets at build time. it is
fail-soft, so the same web code runs unchanged in a plain browser, where
`appiary.native` is false and permission states read as granted (the browser
asked already or will in its own way).

## push notifications (owner setup, once per app)

appiary never sends pushes. the owner's own backend does, with the owner's
own keys. appiary's job is making the device legally allowed to receive
them and handing the device token to the web app:

1. **ios**: create an apns key (.p8) in the apple developer portal, store it
   in the vault, and flip the push notification capability for the app id in
   the portal (one-time manual step; automating the portal toggle is a
   follow-up). declaring the `push` capability injects the
   `aps-environment` entitlement and its signing reference automatically.
2. **android**: create a firebase project, enable cloud messaging, and
   store the resulting google-services.json in the vault. it lands in the
   app at build time. the backend then sends through fcm.
3. **app side**: the web app calls `appiary.push.register()`, listens
   `appiary.push.token(t => ...)`, and posts the token to the owner's
   backend. from there the backend pushes via fcm / apns using its own
   credentials.

## in-app notifications

two layers, one plumbing decision:

- **in-web-app notifications** (the red dot, the dropdown feed, the unread
  badge inside the ui) are the owner's web app doing what it already does on
  the web. nothing new ships for this; it works the moment the app wraps.
- **os-level notifications** (banner, lock screen, tray) go through the
  system. while the app is foregrounded the os stays quiet by design, so
  foreground payloads arrive via `appiary.push.onMessage(payload => ...)`
  and the owner's ui renders them in its own notification style. that is
  the recommended in-app notification pattern: one payload, two renderings,
  zero duplicated backend work.
- **scheduled/reminders**: `appiary.local.schedule({ id, title, body,
  schedule })` for calendar-style reminders the web cannot deliver when the
  app is backgrounded (web push on mobile is not a thing).

honest limits: ios carries no launcher-badge bridge in v1 (badge count from
a foreground webview needs a small custom plugin; parked), and android
launcher badges are oem-specific with no standard api.

## device permissions and feature gating

capabilities are declared at intake (camera, microphone, location, photo
library, push). declaration injects the os-facing requirements (ios usage
descriptions, android manifest permissions) at build time; apple rejects
apps that request without declaring, so intake is the single gate.

on device, the bridge normalizes every capability to one state vocabulary:

| state | meaning | what the owner's app should do |
|---|---|---|
| granted | os permission holds | full feature |
| prompt | never asked, dialog will show | ask in context, then feature |
| blocked | asked and refused; dialog will not return (ios denial, android rationale) | fallback mode; a settings trip is the only recovery |
| unknown | cannot determine (mic on some webviews, outside native) | degrade gracefully |

the pattern we recommend owners build: check `appiary.permissions.state(id)`
at the moment a feature needs it, not at launch. show the feature's context
first, request via `appiary.permissions.request(id)`, and map blocked to a
real fallback (no-camera mode, manual location entry, read-only view).
permission-aware apps score better in review than ones that front-load
every dialog. microphone has no core capacitor plugin: it asks through the
webview's own media api, which is why its state can be unknown on some
devices; treat unknown as prompt-with-caution.

## accessibility

inheritance, not duplication: the webview inherits the device's settings
and the web app's accessibility tree passes through to voiceover / talkback.
concretely:

- **dark mode**: `prefers-color-scheme` tracks the system setting.
- **reduced motion**: `prefers-reduced-motion` tracks the system setting;
  honor it in css transitions.
- **text size**: android's font scale applies to the webview automatically.
  ios dynamic type needs the app's css to use relative units (`rem`,
  `clamp`); fixed pixel fonts will not grow.
- **screen readers**: voiceover and talkback read the web app's existing
  semantics (labels, roles, focus order). nothing is added or subtracted
  by the shell.

wcag compliance remains the owner's code's job; the shell's job is to not
break what the browser already does.
