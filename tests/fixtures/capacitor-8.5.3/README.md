# capacitor 8.5.3 platform templates (fixtures)

ground truth for the runner-side patches, fetched 2026-10-19:

- `ios/` from the `ios-pods-template.tar.gz` asset inside `@capacitor/cli`
  8.5.3 on the npm registry
- `android/` from the `android-template` directory of the capacitor repo at
  tag 8.5.3

these are the exact files `npx cap add` copies when it generates the
platforms, so tests exercising src/runtime-patch.js run against real
capacitor shapes, not approximations. capacitor is mit-licensed.
