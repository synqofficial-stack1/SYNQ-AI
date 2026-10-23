// Builds the Android launcher icon layers and the Google Play listing graphics
// from the Synq app icon, so the brand art lives in one source file.
//
//   node scripts/generate-android-assets.cjs
//
// Uses jimp-compact and pngjs, which Expo already installs for its own icon work.

const fs = require('node:fs');
const path = require('node:path');
const Jimp = require('jimp-compact');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..');
// The 1254 px white-on-black icon is the sharpest copy of the mark; synq-mark.png is only 448 px tall.
const source = path.join(root, 'assets/images/synq-app-icon.png');
const BACKGROUND = 0x09090bff; // matches the splash and app.json userInterfaceStyle
const GOLD = { r: 0xd4, g: 0xaf, b: 0x37 }; // AccentColors.primary

let cachedMark;
/** The white mark on transparency, cropped to its edges. Brightness becomes alpha, which keeps the anti-aliasing. */
async function sourceMark() {
  if (cachedMark) return cachedMark.clone();
  const icon = await Jimp.read(source);
  let left = icon.bitmap.width, top = icon.bitmap.height, right = 0, bottom = 0;
  icon.scan(0, 0, icon.bitmap.width, icon.bitmap.height, function (x, y, idx) {
    const d = this.bitmap.data;
    const alpha = Math.round((d[idx] + d[idx + 1] + d[idx + 2]) / 3);
    d[idx] = d[idx + 1] = d[idx + 2] = 255;
    d[idx + 3] = alpha < 12 ? 0 : alpha;
    if (d[idx + 3]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  });
  cachedMark = icon.crop(left, top, right - left + 1, bottom - top + 1);
  return cachedMark.clone();
}

async function markAt(height) {
  return (await sourceMark()).resize(Jimp.AUTO, Math.round(height), Jimp.RESIZE_BICUBIC);
}

/** jimp-compact writes a corrupt file when asked for RGB-only PNG, so pngjs drops the alpha. */
function writeOpaquePng(image, file) {
  const png = new PNG({ width: image.bitmap.width, height: image.bitmap.height });
  png.data = image.bitmap.data;
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 2, inputHasAlpha: true }));
}

async function centered(canvas, mark, offsetX = 0) {
  canvas.composite(mark, Math.round((canvas.bitmap.width - mark.bitmap.width) / 2 + offsetX), Math.round((canvas.bitmap.height - mark.bitmap.height) / 2));
  return canvas;
}

/** A soft gold glow behind the mark, fading to the background colour. */
function glow(canvas, radius) {
  const cx = canvas.bitmap.width / 2;
  const cy = canvas.bitmap.height / 2;
  canvas.scan(0, 0, canvas.bitmap.width, canvas.bitmap.height, function (x, y, idx) {
    const t = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / radius) ** 2 * 0.28;
    this.bitmap.data[idx] = Math.round(this.bitmap.data[idx] * (1 - t) + GOLD.r * t);
    this.bitmap.data[idx + 1] = Math.round(this.bitmap.data[idx + 1] * (1 - t) + GOLD.g * t);
    this.bitmap.data[idx + 2] = Math.round(this.bitmap.data[idx + 2] * (1 - t) + GOLD.b * t);
  });
  return canvas;
}

async function main() {
  // Adaptive icons are masked to a circle or squircle and may be zoomed by the
  // launcher. Only the central 66 of 108 dp is guaranteed visible, so the
  // mark's whole bounding box (aspect ~0.7) is kept inside that circle: about
  // half the canvas height.
  const foreground = await centered(new Jimp(1024, 1024, 0x00000000), await markAt(1024 * 0.5));
  await foreground.writeAsync(path.join(root, 'assets/images/android/synq-adaptive-foreground.png'));
  // Android 13+ themed icons tint this layer, so only its alpha matters; the
  // white-on-transparent mark is already the right shape.
  await foreground.clone().writeAsync(path.join(root, 'assets/images/android/synq-adaptive-monochrome.png'));

  // Play Store listing icon: 512 x 512, opaque. Play rounds the corners itself.
  const playIcon = await centered(glow(new Jimp(512, 512, BACKGROUND), 300), await markAt(512 * 0.62));
  await playIcon.writeAsync(path.join(root, 'assets/store/play-icon-512.png'));

  // Feature graphic: 1024 x 500, shown above the listing. No text, as Google
  // recommends; the store page carries the name.
  // Play rejects a feature graphic with an alpha channel, so it is written as RGB.
  const feature = await centered(glow(new Jimp(1024, 500, BACKGROUND), 420), await markAt(500 * 0.62));
  writeOpaquePng(feature, path.join(root, 'assets/store/play-feature-graphic.png'));

  console.log('Wrote Android icon layers to assets/images/android and Play graphics to assets/store.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
