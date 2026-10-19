"""Extract the user-supplied short laugh using Blender's bundled decoder.

Run Blender --background --factory-startup --disable-autoexec --python this.py
-- --input /path/to/video.mp4. The original video is never copied or changed.
"""
import argparse
import hashlib
import json
import math
import sys
import wave
from pathlib import Path

import aud
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, default=ROOT / 'assets/audio/nailong-laugh.wav')
parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/laugh-audio-report.json')
parser.add_argument('--start', type=float, default=.55)
parser.add_argument('--end', type=float, default=1.60)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
sound = aud.Sound(str(args.input)).rechannel(1).resample(44100)
decoded = sound.data()[:, 0].astype(np.float64)
rate = 44100
if not 0 <= args.start < args.end <= len(decoded) / rate:
    parser.error('The selected interval must lie inside the decoded audio')
clip = decoded[round(args.start * rate):round(args.end * rate)].copy()
if not np.isfinite(clip).all() or np.max(np.abs(clip)) < 1e-6:
    raise ValueError('The selected interval must contain finite, audible samples')
for milliseconds, reverse in [(10, False), (60, True)]:
    count = min(len(clip), round(milliseconds * rate / 1000))
    envelope = np.linspace(0, 1, count)
    if reverse:
        clip[-count:] *= envelope[::-1]
    else:
        clip[:count] *= envelope
clip *= 10 ** (-3 / 20) / np.max(np.abs(clip))
pcm = np.rint(clip * 32767).astype('<i2')
args.output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(args.output), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(rate)
    output.writeframes(pcm.tobytes())
report = {
    'source_name': args.input.name,
    'source_sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(),
    'source_decoded_seconds': len(decoded) / rate,
    'start_seconds': args.start, 'end_seconds': args.end,
    'seconds': len(pcm) / rate, 'sample_rate': rate, 'channels': 1, 'bits_per_sample': 16,
    'fade_in_ms': 10, 'fade_out_ms': 60, 'target_peak_dbfs': -3,
    'actual_peak_dbfs': 20 * math.log10(float(np.max(np.abs(pcm.astype(float)))) / 32767),
    'rms_dbfs': 20 * math.log10(float(np.sqrt(np.mean((pcm.astype(float) / 32767) ** 2)))),
    'clipped_samples': int(np.count_nonzero(np.abs(pcm.astype(int)) >= 32767)),
    'first_sample': int(pcm[0]), 'last_sample': int(pcm[-1]),
    'wav_bytes': args.output.stat().st_size,
    'wav_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
}
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
