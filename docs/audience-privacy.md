# audience and privacy: 18+, kids, and the policy layer

who the app is for changes what the stores require. three verdicts, one
structural fact that makes appiary's story simple:

**the shell itself collects nothing.** no analytics, no telemetry, no
tracking sdk - the native shell is exactly the permissions and plugins
declared at intake plus the owner's web app. every data-collection
question the stores ask about is therefore a question about the owner's
own code, honestly answerable by the owner. the shell has no hidden
privacy surface to discover at review time.

## 18+ / mature-content apps

- **sexually explicit content is dead on arrival** in both major app
  stores (apple rejects it outright; google play policy prohibits it)
  and in the samsung galaxy store. no wrapping changes this; we say no
  at intake rather than take the build fee.
- **legal age-restricted categories** (gambling with jurisdictional
  licensing, alcohol brands, mature themes, horror content) are
  possible with the full ceremony: correct age rating from the
  store's questionnaire (17+ is apple's ceiling; play's mature
  ratings), the app's own age gate before any gated content, and for
  gambling the licenses per jurisdiction. these categories draw the
  strictest review scrutiny of anything we ship; intake should ask
  the licensing question up front.

## children's apps (kids category / designed for families)

possible, and the most compliance-heavy app class we accept:

- **apple kids category**: ads and analytics are restricted to
  specific compliant providers, behavioral tracking is banned, and
  purchases need parental gates.
- **google play families policy**: only families-approved analytics
  sdks, ads only through certified networks, a families questionnaire
  the owner completes in the play console, and a target api level
  requirement the shell satisfies by tracking current capacitor.
- **coppa** (us, under-13) and **gdpr-k** (consent ages vary by
  country) are the owner's legal obligations. the shell-collects-
  nothing property is the owner's strongest single fact here: their
  privacy surface is exactly their own web app's, so a compliant web
  app ships compliant.
- honest practical note: the declared audience is a store-console
  questionnaire the owner fills at first submission; if the app is
  aimed at kids and the owner declares it as general-audience to
  dodge the kids requirements, that is their compliance failure to
  make, and our docs do not coach it.

## privacy policy (mandatory, and currently manual)

both stores require a live privacy policy url for every app, apple
requires the privacy "nutrition label" declarations in app store
connect, and play requires the data safety form. these are store-
console steps the owner completes at first submission - which in v1
is already a manual step by design (the first upload of a new app is
the owner's console moment, later builds automate).

what appiary does in v1: asks at intake whether the owner has a
privacy policy url and warns before dispatch when the answer is no,
because the store submission will bounce without one. what we do not
do: write the owner's policy for them, or submit store metadata on
their behalf (automated metadata submission is a v2 lane alongside
icon/splash).

compliance responsibility sits with the owner, plainly: appiary
surfaces the requirements at the right moments; the owner answers
them truthfully. our own platform privacy (owner credentials, build
artifacts, push tokens routed through the owner's own backend) is
documented separately in the platform terms.

## user-uploaded images and exif (where stripping happens)

when an end user uploads a photo inside a shipped app, the bytes go
through the owner's own upload pipeline - the shell never proxies the
owner's api calls, so **appiary does not strip exif, and cannot
without intercepting the owner's pipeline**, which we do not do.

what that means concretely:

- photos picked via the camera capability keep their metadata by
  default - **including gps coordinates** if the os camera saved
  location on. an unstripped photo upload is a personal-data leak
  (and a kids-app disaster under coppa/gdpr-k).
- the fix is the owner's pipeline, and there are exactly two sound
  places for it: strip server-side on upload (one image library call,
  the crisp universal answer), or re-encode client-side through a
  canvas before upload (a canvas re-encode drops exif by nature). a
  v2 bridge helper (`appiary.media.stripExif`) can make the second
  one-liner, but the server-side strip is the recommendation because
  it cannot be bypassed by the client.
- the owner's privacy policy and data-safety declarations must
  describe what actually happens to uploaded photos - and since the
  shell-collects-nothing property ends where the owner's pipeline
  begins, that description is theirs to get right.
