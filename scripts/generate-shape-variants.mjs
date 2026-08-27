import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const playableRoot = path.resolve(projectRoot, '..', 'BusLoopPlayable_2.0');
const androidDir = path.join(projectRoot, 'applovin', 'Android');
const iosDir = path.join(projectRoot, 'applovin', 'IOS');
const assetRoot = path.join(playableRoot, 'public', 'assets');
const textureRoot = path.join(assetRoot, 'applovin', 'textures');
const families = ['Fish', 'Heart', 'Rainbow', 'Duck'];
const maxPackageBytes = 5_000_000;

function dataUri(filePath, mimeType) {
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExpected(source, from, to, expectedCount, label) {
  const count = countOccurrences(source, from);
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrences, found ${count}.`);
  }
  return source.replaceAll(from, to);
}

function sha256(source) {
  return crypto.createHash('sha256').update(source).digest('hex').toUpperCase();
}

const icons = {
  Android: dataUri(path.join(assetRoot, 'icon-android.jpg'), 'image/jpeg'),
  IOS: dataUri(path.join(assetRoot, 'icon-ios.png'), 'image/png')
};

const backgrounds = [
  {
    suffix: '',
    label: 'BG01 winter',
    uri: dataUri(path.join(textureRoot, 'BG01_split01_q60.jpg'), 'image/jpeg')
  },
  {
    suffix: '_JP',
    label: 'BG01 Sakura',
    uri: dataUri(path.join(textureRoot, 'BG01_split01_Sakura_q60.jpg'), 'image/jpeg')
  },
  {
    suffix: '_winter',
    label: 'BG02 winter',
    uri: dataUri(path.join(textureRoot, 'BG02_split01_winter_q60.jpg'), 'image/jpeg')
  },
  {
    suffix: '_summer',
    label: 'BG02 summer',
    uri: dataUri(path.join(textureRoot, 'BG02_split01_summer_q60.jpg'), 'image/jpeg')
  }
];

const baseBackground = backgrounds[0].uri;
const written = [];

for (const family of families) {
  const baseName = `Bus Fever - Car Jam Escape Playable_applovin_Android_${family}_shape.html`;
  const sourcePath = path.join(androidDir, baseName);
  const source = fs.readFileSync(sourcePath, 'utf8');

  if (countOccurrences(source, baseBackground) !== 2) {
    throw new Error(`${baseName}: expected two BG01 winter background copies.`);
  }
  const androidIconCount = countOccurrences(source, icons.Android);
  const iosIconCount = countOccurrences(source, icons.IOS);
  if (androidIconCount + iosIconCount !== 1) {
    throw new Error(`${baseName}: expected exactly one recognized platform Icon.`);
  }
  const sourceIcon = iosIconCount === 1 ? icons.IOS : icons.Android;
  if (!/branding:\{icon:\{enabled:[01],locked:[01],asset:"[^"]+",x:[^,]+,y:2026,width:180,height:123\}/.test(source)) {
    throw new Error(`${baseName}: Android Icon geometry does not match the expected platform baseline.`);
  }

  const normalizedSource = source
    .replaceAll(baseBackground, '<BACKGROUND>')
    .replace(sourceIcon, '<ICON>');

  for (const background of backgrounds) {
    const backgroundContent = background.suffix
      ? replaceExpected(
          source,
          baseBackground,
          background.uri,
          2,
          `${family}${background.suffix} background`
        )
      : source;
    const androidContent = sourceIcon === icons.Android
      ? backgroundContent
      : replaceExpected(
          backgroundContent,
          icons.IOS,
          icons.Android,
          1,
          `${family}${background.suffix} Android Icon`
        );
    const androidName = `Bus Fever - Car Jam Escape Playable_applovin_Android_${family}_shape${background.suffix}.html`;
    const androidPath = path.join(androidDir, androidName);
    fs.writeFileSync(androidPath, androidContent);

    const normalizedAndroid = androidContent
      .replaceAll(background.uri, '<BACKGROUND>')
      .replace(icons.Android, '<ICON>');
    if (normalizedAndroid !== normalizedSource) {
      throw new Error(`${androidName}: content changed outside the requested background replacement.`);
    }

    let iosContent = sourceIcon === icons.IOS
      ? backgroundContent
      : replaceExpected(
          backgroundContent,
          icons.Android,
          icons.IOS,
          1,
          `${family}${background.suffix} IOS Icon`
        );
    iosContent = iosContent.replace(
      /(branding:\{icon:\{enabled:[01],locked:[01],asset:"[^"]+",x:[^,]+,y:)2026(,width:180,height:123\})/,
      (_, prefix, suffix) => `${prefix}2017${suffix}`
    );
    if (!/branding:\{icon:\{enabled:[01],locked:[01],asset:"[^"]+",x:[^,]+,y:2017,width:180,height:123\}/.test(iosContent)) {
      throw new Error(`${family}${background.suffix}: IOS Icon geometry replacement failed.`);
    }

    const normalizedIos = iosContent
      .replaceAll(background.uri, '<BACKGROUND>')
      .replace(icons.IOS, '<ICON>')
      .replace(
        /(branding:\{icon:\{enabled:[01],locked:[01],asset:"<ICON>",x:[^,]+,y:)2017(,width:180,height:123\})/,
        (_, prefix, suffix) => `${prefix}2026${suffix}`
      );
    if (normalizedIos !== normalizedSource) {
      throw new Error(`${family}${background.suffix}: IOS content changed outside Icon and platform position.`);
    }

    const iosName = `Bus Fever - Car Jam Escape Playable_applovin_IOS_${family}_shape${background.suffix}.html`;
    const iosPath = path.join(iosDir, iosName);
    fs.writeFileSync(iosPath, iosContent);

    for (const [platform, outputPath, content] of [
      ['Android', androidPath, androidContent],
      ['IOS', iosPath, iosContent]
    ]) {
      const bytes = Buffer.byteLength(content);
      if (bytes >= maxPackageBytes) {
        throw new Error(`${path.basename(outputPath)} exceeds ${maxPackageBytes} bytes.`);
      }
      if (countOccurrences(content, background.uri) !== 2) {
        throw new Error(`${path.basename(outputPath)} does not contain exactly two selected backgrounds.`);
      }
      written.push({
        platform,
        family,
        background: background.label,
        file: path.basename(outputPath),
        bytes,
        sha256: sha256(content)
      });
    }
  }
}

console.log(JSON.stringify({ packages: written.length, written }, null, 2));
