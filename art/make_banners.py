# Баннеры бота из иконки сервера: python make_banners.py  -> profile_banner.png (680x240), panel_banner.png (1200x400), avatar.png
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
icon = Image.open(os.path.join(HERE, 'icon.png')).convert('RGB')
F = 'C:/Windows/Fonts/'
serif = lambda s: ImageFont.truetype(F + 'georgiab.ttf', s)
sans = lambda s: ImageFont.truetype(F + 'segoeui.ttf', s)


def banner(w, h, title_size, sub_size, sub, with_icon=True):
    # фон: иконка, растянутая на ширину, размытая и затемнённая — тот же гранж
    bg = ImageOps.fit(icon, (w, h), centering=(0.5, 0.42)).filter(ImageFilter.GaussianBlur(h / 40))
    bg = ImageEnhance.Brightness(ImageOps.grayscale(bg).convert('RGB')).enhance(0.35)
    # затемнение слева направо под текст
    grad = Image.linear_gradient('L').rotate(90).resize((w, h))
    bg = Image.composite(bg, Image.new('RGB', (w, h), (8, 8, 8)), grad.point(lambda v: 90 + v * 0.6))
    # круглая иконка слева
    s = int(h * 0.78)
    mask = Image.new('L', (s * 4, s * 4)); ImageDraw.Draw(mask).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    mask = mask.resize((s, s), Image.LANCZOS)
    x0, y0 = int(h * 0.11), (h - s) // 2
    glow = Image.new('L', (w, h)); ImageDraw.Draw(glow).ellipse((x0 - 6, y0 - 6, x0 + s + 6, y0 + s + 6), fill=120)
    if with_icon:
        bg.paste((210, 210, 210), (0, 0), glow.filter(ImageFilter.GaussianBlur(10)))
        bg.paste(icon.resize((s, s), Image.LANCZOS), (x0, y0), mask)
    d = ImageDraw.Draw(bg)
    t_font, s_font = serif(title_size), sans(sub_size)
    # без иконки текст справа: в профиле слева снизу лежит аватар
    tx = x0 + s + int(h * 0.12) if with_icon else w - d.textlength('ISEE MODS', font=t_font) - int(h * 0.15)
    th = d.textbbox((0, 0), 'ISEE MODS', font=t_font)[3]
    ty = (h - th - sub_size * 1.6) // 2
    d.text((tx + 2, ty + 2), 'ISEE MODS', font=t_font, fill=(0, 0, 0))
    d.text((tx, ty), 'ISEE MODS', font=t_font, fill=(222, 222, 222))
    ly = ty + th + int(sub_size * 0.5)
    d.line((tx, ly, tx + int(w * 0.36), ly), fill=(140, 140, 140), width=max(1, h // 200))
    d.text((tx, ly + int(sub_size * 0.35)), sub, font=s_font, fill=(170, 170, 170))
    # тонкая рамка
    d.rectangle((0, 0, w - 1, h - 1), outline=(60, 60, 60), width=max(2, h // 120))
    return bg


banner(680, 240, 52, 18, 'Моды для DayZ-серверов', with_icon=False).save(os.path.join(HERE, 'profile_banner.png'))
banner(1200, 400, 92, 30, 'Моды для DayZ-серверов  ·  ключ сразу после оплаты').save(os.path.join(HERE, 'panel_banner.png'))
print('ok', icon.size)
