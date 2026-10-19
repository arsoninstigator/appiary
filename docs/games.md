# mobile games on the shell

can an appiary app be a game? the honest engineering answer, in three
parts.

## what works

the webview is not a browser tab; it is a full rendering surface:

- **canvas and webgl run hardware-accelerated** (metal on ios, via the
  system webview on android). three.js, babylon, playcanvas, phaser,
  pixi: casual and mid-core games run at full display refresh. this is
  the same class of device that runs html5 games in ads at 120 hz.
- **web audio** covers sfx and music. latency is fine for casual play;
  it is not openal. rhythm games that need sub-frame audio sync will
  feel it.
- **haptics ship in the bridge**: `appiary.haptics.impact('heavy')`,
  `notification('success')`, `vibrate(ms)`.
- **orientation lock ships in the bridge**:
  `appiary.orientation.lock('landscape')` for landscape-first games, and
  unlock for menu screens.
- **input**: multi-touch and pointer events pass through at native
  sample rates. the gamepad api is partial on mobile webviews; assume
  touch.

## what to budget for

- **memory**: low-end android webviews are the floor. asset budgets that
  pass on a flagship will oom a 2 gb device; stream levels instead of
  shipping one bundle.
- **thermal**: sustained webgl load throttles on phones faster than
  native engines because the webview layer adds overhead. cap frame
  cost, not just frame rate.
- **first load**: bundle mode ships assets inside the binary. a 100 mb
  download loses players and store ranking; treat under ~50 mb as the
  casual-game budget. live-asset games should keep a small shell and
  stream content from their own hosting.

## what does not work, said plainly

- no native game engine access (unity, unreal) and no native low-latency
  audio. if a game needs those, it is not a web app and appiary is the
  wrong tool for it.
- no controller rumble detail, no gpu-level anti-cheat, no native
  leaderboards. leaderboards and saves are the owner's backend, like
  every other lane.

## apple review, the real gate

apple's 4.2 minimum-functionality rule is the historical killer of
"wrapped web page" games. a real game - state, progression, feedback -
passes; a web page with a canvas does not. bundle mode is the answer to
4.2 (assets in the binary, no blank shell), and game submissions should
show: menu -> gameplay -> save/restore. we do not promise review
outcomes for anyone's game; we give it the same honest packaging as any
other app.

## the short verdict

casual and mid-core games (match, runner, puzzle, word, idle, board):
yes, ship it. heavy 3d, sub-frame audio sync, anti-cheat-grade: no, and
saying so is cheaper than a refund.

## connecting to google play (and game center)

"connected" games - achievements, leaderboards, the play games profile -
are a native sdk story, and the ecosystem had nothing usable: the one
public capacitor plugin (gammafp) targets capacitor 5 on the retired v1
sdk, which google killed for new apps in 2024. so appiary ships its own.

declaring the `gameServices` capability installs a first-party in-repo
plugin (`template/plugins/appiary-game-services`) and wires the native
side automatically:

- **android**: play games v2 (sign-in via the play store account picker,
  achievements, leaderboards, player profile). v2 initialization is
  injected into MainActivity at build time; v2 needs no manifest app id.
- **ios**: game center, same shape: sign-in, achievements, leaderboard
  scores, the native game center ui. the game-center entitlement is
  injected alongside push's when declared.

the bridge normalizes both stores into one surface:

```js
appiary.gameServices.available()          // false until the capability is declared
appiary.gameServices.signIn()             // { authenticated: true } - store handles the picker
appiary.gameServices.unlock('achId')      // resource id from the store console
appiary.gameServices.increment('achId', 5)
appiary.gameServices.submitScore('lbId', 12500)
appiary.gameServices.playerInfo()         // { id, displayName, title }
appiary.gameServices.showAchievements()   // native ui overlay
appiary.gameServices.showLeaderboards()
```

owner setup is console work, not code work: play console - create the
game services project, link the app, declare achievements/leaderboards,
paste the resource ids into the web app. app store connect - enable
game center and declare the same. the ids are ordinary constants in the
owner's web code; nothing appiary-specific about them.

honest status: the plugin's api calls are verified against the play
games v2 and gamekit docs, but it has never been compiled - there is no
mac and no android sdk in this room. the first `gameServices` push is
its compile test, and that is stated here rather than implied.

one more honest limit: google play games on pc (the desktop program)
requires native pc-compatible builds; webview games are not eligible.
saying so up front beats a support ticket later.
