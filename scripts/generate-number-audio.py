"""
Generate TTS audio files for Tambola numbers 1-90.
Uses edge-tts (free, no API key needed).

Install: pip install edge-tts
Run:     python scripts/generate-number-audio.py

Output:  public/sounds/numbers/1.mp3 through 90.mp3
"""

import asyncio
import os
import edge_tts

# Voice: en-US-GuyNeural (clear male), en-US-JennyNeural (female)
VOICE = "en-US-GuyNeural"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sounds", "numbers")

# Number words
ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
         "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def number_to_words(n):
    if n < 10:
        return ONES[n]
    if n < 20:
        return TEENS[n - 10]
    t, o = divmod(n, 10)
    if o == 0:
        return TENS[t]
    return f"{TENS[t]} {ONES[o]}"


def make_phrase(n):
    return f"Number {number_to_words(n)}"


async def generate_all():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for n in range(1, 91):
        phrase = make_phrase(n)
        out_path = os.path.join(OUTPUT_DIR, f"{n}.mp3")

        if os.path.exists(out_path):
            print(f"  Skip {n} (exists)")
            continue

        print(f"  Generating {n}: \"{phrase}\"")
        communicate = edge_tts.Communicate(phrase, VOICE, rate="-5%", pitch="+0Hz")
        await communicate.save(out_path)

    print(f"\nDone! Generated files in {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(generate_all())
