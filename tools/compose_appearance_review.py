"""Assemble unchanged offline renders into labeled review sheets and a loop."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
out = ROOT / 'artifacts'
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
sheet = Image.new('RGB', (1200, 818), '#111d23')
draw = ImageDraw.Draw(sheet)
for x, path, label in [(0, out / 'appearance-before/model-front.png', '修改前'),
                       (600, out / 'model-front.png', '修改后 · 眼距收窄，中线修复')]:
    with Image.open(path) as shot:
        sheet.paste(shot.convert('RGB'), (x, 58))
    draw.text((x + 24, 14), label, font=font, fill='#eeeadd')
sheet.save(out / 'appearance-before-after.png')

frames = [Image.open(path).convert('RGB')
          for path in sorted((ROOT / '.cache/appearance-idle').glob('*.png'))]
assert len(frames) == 30
# GIF units are centiseconds: 60/70/70 ms per three frames gives exactly 2 s.
frames[0].save(out / 'appearance-idle.gif', save_all=True, append_images=frames[1:],
               duration=[60, 70, 70] * 10, loop=0, disposal=2)
phases = Image.new('RGB', (320 * 5, 448), '#111d23')
draw = ImageDraw.Draw(phases)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
for column, index in enumerate([0, 7, 15, 22, 29]):
    phases.paste(frames[index], (column * 320, 42))
    draw.text((column * 320 + 16, 10), f'待机 {index / 15:.2f} 秒',
              font=small, fill='#eeeadd')
phases.save(out / 'appearance-idle-phases.png')
for frame in frames:
    frame.close()
print('APPEARANCE_REVIEW_COMPOSED')
