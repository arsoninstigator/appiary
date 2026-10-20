/**
 * icon/splash generation service (v1.1).
 *
 * a separate service by design - the template does not depend on this
 * and builds never install image tooling. the dashboard/intake layer
 * generates an asset tree ONCE from an owner's source square image;
 * the emitted files land in a staged `iconset/` directory that
 * `apply-runtime` post copies verbatim into the generated platforms.
 *
 * outputs:
 * - ios: AppIcon.appiconset (single-scale entries + 1024 marketing
 *   icon + Contents.json), Splash.imageset (storyboard splash at all
 *   scales + Contents.json)
 * - android: legacy launcher pngs per density, adaptive layers
 *   (ic_launcher_foreground/background per density) +
 *   mipmap-anydpi-v26/ic_launcher.xml, and a splash image per density
 *   sized 1:1 to the screen (the @capacitor/splash-screen pattern)
 */
import sharp from 'sharp'

/** ios appiconset entries for xcode 15+ style single-scale catalogs.
 *  the 1024x1024 marketing icon doubles as every slot's source. */
const IOS_ICON_ENTRIES = [
  { size: 20, scales: [2, 3] },
  { size: 29, scales: [2, 3] },
  { size: 40, scales: [2, 3] },
  { size: 60, scales: [2, 3] },
  { size: 1024, scales: [1] }
]

/** android launcher densities (px for a 48dp base icon). */
const ANDROID_DENSITIES = [
  { name: 'mdpi', px: 48 },
  { name: 'hdpi', px: 72 },
  { name: 'xhdpi', px: 96 },
  { name: 'xxhdpi', px: 144 },
  { name: 'xxxhdpi', px: 192 }
]

/** adaptive icon foreground/background (108dp layers; safe zone 66dp). */
const ADAPTIVE_DENSITIES = [
  { name: 'mdpi', px: 108 },
  { name: 'hdpi', px: 162 },
  { name: 'xhdpi', px: 216 },
  { name: 'xxhdpi', px: 324 },
  { name: 'xxxhdpi', px: 432 }
]

/** splash image widths per android density (16:9-ish 1:1 screen fill). */
const SPLASH_DENSITIES = [
  { name: 'mdpi', w: 320, h: 480 },
  { name: 'hdpi', w: 480, h: 800 },
  { name: 'xhdpi', w: 720, h: 1280 },
  { name: 'xxhdpi', w: 1080, h: 1920 },
  { name: 'xxxhdpi', w: 1440, h: 2560 }
]

async function resizePng(source, px, opts = {}) {
  return sharp(source).resize(px, px, { fit: opts.fit || 'contain' }).png().toBuffer()
}

/**
 * generate the full asset tree from a source square png.
 * returns [{ path, data }] - paths are relative to the iconset root:
 *   ios/Assets.xcassets/AppIcon.appiconset/*
 *   ios/Assets.xcassets/Splash.imageset/*
 *   android/res/mipmap-[density]/...
 * opts: { background: '#rrggbb' } - splash + adaptive background fill
 */
export async function generateIconSet(source, opts = {}) {
  const meta = await sharp(source).metadata()
  if (!meta.width || meta.width !== meta.height) {
    throw new Error('source icon must be square')
  }
  if (meta.width < 1024) {
    throw new Error('source icon must be at least 1024x1024')
  }
  const background = opts.background || '#ffffff'
  const files = []

  /* ---- ios appiconset ---- */
  const iconset = 'ios/Assets.xcassets/AppIcon.appiconset'
  const iconEntries = []
  for (const entry of IOS_ICON_ENTRIES) {
    for (const scale of entry.scales) {
      const px = entry.size * scale
      const name = `icon-${entry.size}@${scale}x.png`
      files.push({ path: `${iconset}/${name}`, data: await resizePng(source, px) })
      iconEntries.push({
        filename: name,
        idiom: 'universal',
        platform: 'ios',
        size: `${entry.size}x${entry.size}`,
        scale: scale === 1 ? undefined : `${scale}x`
      })
    }
  }
  files.push({
    path: `${iconset}/Contents.json`,
    data: Buffer.from(JSON.stringify({
      images: iconEntries,
      info: { author: 'appiary icon service', version: 1 }
    }, null, 2))
  })

  /* ---- ios splash imageset (storyboard image at 1x/2x/3x) ---- */
  const splashset = 'ios/Assets.xcassets/Splash.imageset'
  const splashScales = [{ s: 1, w: 320, h: 480 }, { s: 2, w: 800, h: 1200 }, { s: 3, w: 1200, h: 1800 }]
  const splashEntries = []
  for (const sc of splashScales) {
    const name = `splash@${sc.s}x.png`
    const img = await sharp({
      create: { width: sc.w, height: sc.h, channels: 4, background }
    }).png().toBuffer()
    files.push({ path: `${splashset}/${name}`, data: img })
    splashEntries.push({ filename: name, idiom: 'universal' })
  }
  files.push({
    path: `${splashset}/Contents.json`,
    data: Buffer.from(JSON.stringify({
      images: splashEntries.map((e, i) => ({ ...e, scale: `${i + 1}x` })),
      info: { author: 'appiary icon service', version: 1 }
    }, null, 2))
  })

  /* ---- android legacy + adaptive launchers ---- */
  for (const d of ANDROID_DENSITIES) {
    files.push({ path: `android/res/mipmap-${d.name}/ic_launcher.png`, data: await resizePng(source, d.px) })
  }
  for (const d of ADAPTIVE_DENSITIES) {
    files.push({
      path: `android/res/mipmap-${d.name}/ic_launcher_foreground.png`,
      data: await resizePng(source, Math.round(d.px * 66 / 108))
    })
    files.push({
      path: `android/res/mipmap-${d.name}/ic_launcher_background.png`,
      data: await sharp({
        create: { width: d.px, height: d.px, channels: 4, background }
      }).png().toBuffer()
    })
  }
  files.push({
    path: 'android/res/mipmap-anydpi-v26/ic_launcher.xml',
    data: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`)
  })

  /* ---- android splash images (1:1 screen fill per density) ---- */
  for (const d of SPLASH_DENSITIES) {
    files.push({
      path: `android/res/drawable-${d.name}/splash.png`,
      data: await sharp({
        create: { width: d.w, height: d.h, channels: 4, background }
      }).png().toBuffer()
    })
  }

  return files
}
