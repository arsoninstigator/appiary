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
