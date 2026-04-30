/**
 * Generate TTS audio files for Tambola numbers 1-90.
 * Uses msedge-tts (free Microsoft Edge TTS, no API key needed).
 *
 * Run: node scripts/generate-number-audio.mjs
 * Output: public/sounds/numbers/1.mp3 through 90.mp3
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'public', 'sounds', 'numbers');
const TEMP_DIR = join(__dirname, '..', '.tts-temp');

const VOICE = 'en-US-GuyNeural';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (o === 0) return TENS[t];
  return `${TENS[t]} ${ONES[o]}`;
}

function makePhrase(n) {
  return `Number ${numberToWords(n)}`;
}

async function generateAll() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(TEMP_DIR, { recursive: true });

  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  for (let n = 1; n <= 90; n++) {
    const finalPath = join(OUTPUT_DIR, `${n}.mp3`);

    if (existsSync(finalPath)) {
      console.log(`  Skip ${n} (exists)`);
      continue;
    }

    const phrase = makePhrase(n);
    console.log(`  Generating ${n}: "${phrase}"`);

    try {
      // toFile writes to a directory with auto-generated filename
      const result = await tts.toFile(TEMP_DIR, phrase);
      // Move the generated file to our desired name
      await rename(result.audioFilePath, finalPath);
    } catch (err) {
      console.error(`  Error generating ${n}:`, err.message);
    }
  }

  // Cleanup temp dir
  try {
    const { rm } = await import('fs/promises');
    await rm(TEMP_DIR, { recursive: true, force: true });
  } catch (_) {}

  tts.close();
  console.log(`\nDone! Files in ${OUTPUT_DIR}`);
}

generateAll().catch(console.error);
