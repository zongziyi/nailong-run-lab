"""Assemble unretouched browser captures into a labeled QA contact sheet."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
font_path = 'C:/Windows/Fonts/msyh.ttc'
title_font = ImageFont.truetype(font_path, 27)
label_font = ImageFont.truetype(font_path, 21)
small_font = ImageFont.truetype(font_path, 16)
stages = [
    ('slide', '01  滑铲保持', '0.400 s'),
    ('slide-jump', '02  滑铲接起跳', '0.535 s'),
    ('jump', '03  腾空', '0.650 s'),
    ('dive', '04  空中下铲', '0.785 s'),
    ('landing', '05  落地过渡', '0.900 s'),
    ('landing-slide', '06  落地滑铲', '1.150 s'),
]
sheet = Image.new('RGB', (1256, 1152), '#111d23')
draw = ImageDraw.Draw(sheet)
draw.text((25, 18), '奶龙快跑 · 动作连续衔接', font=title_font, fill='#f0d380')
draw.text((25, 60), '实际浏览器关键帧 · 完整动作可在 action-review.html 中播放、暂停和逐帧复看', font=small_font, fill='#b8c8bd')
for index, (slug, label, time) in enumerate(stages):
    x = 24 + (index % 2) * 628
    y = 105 + (index // 2) * 344
    draw.text((x, y), label, font=label_font, fill='#f5efda')
    draw.text((x + 470, y + 5), time, font=small_font, fill='#a8bdb2')
    capture = Image.open(root / 'artifacts' / f'action-{slug}-browser.png').convert('RGB')
    # Keep the complete canvas and its time/height readouts from each screenshot.
    capture = capture.crop((169, 108, 1082, 590)).resize((602, 318), Image.Resampling.LANCZOS)
    sheet.paste(capture, (x, y + 27))
sheet.save(root / 'artifacts' / 'action-chain-browser.png')
print(root / 'artifacts' / 'action-chain-browser.png')
