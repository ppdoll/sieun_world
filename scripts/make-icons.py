# scripts/make-icons.py
# public/ 의 아이콘과 OG 이미지를 만든다. 디자인을 바꾸면 이 파일을 고치고 다시 실행한다.
#   python scripts/make-icons.py
# 필요: Pillow, 한글 글꼴 (Windows 의 맑은 고딕을 기본으로 찾는다)

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
os.makedirs(ROOT, exist_ok=True)

BG = "#EDF3F8"
INK = "#16324F"
INK2 = "#5D7891"
ACC = "#3D8BD3"
CHIP_A = "#E3EDF6"
CHIP_B = "#F7DDE4"
HL = "#FFE24A"

FONT_CANDIDATES = [
    "C:/Windows/Fonts/malgunbd.ttf",
    "C:/Windows/Fonts/malgun.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
]


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def chips(draw, x, y, parts, size, pad_x, pad_y, gap, colors=(CHIP_A, CHIP_B), ink=INK, radius=None):
    """덩어리 칩을 한 줄로 그리고 전체 폭을 돌려준다."""
    f = font(size)
    cx = x
    radius = radius or size // 4
    for i, p in enumerate(parts):
        w = draw.textlength(p, font=f)
        box = (cx, y, cx + w + pad_x * 2, y + size + pad_y * 2)
        rounded(draw, box, radius, colors[i % 2])
        draw.text((cx + pad_x, y + pad_y - size * 0.12), p, font=f, fill=ink)
        cx = box[2] + gap
    return cx - gap - x


def icon(size):
    """앱 아이콘: 파란 바탕에 덩어리 칩 두 개."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rounded(d, (0, 0, size, size), size * 0.22, ACC)
    s = size
    gap = s * 0.04
    h = s * 0.34
    w = (s * 0.72 - gap) / 2
    x0 = (s - (w * 2 + gap)) / 2
    y0 = (s - h) / 2
    rounded(d, (x0, y0, x0 + w, y0 + h), h * 0.28, CHIP_A)
    rounded(d, (x0 + w + gap, y0, x0 + w * 2 + gap, y0 + h), h * 0.28, CHIP_B)
    if size >= 96:
        f = font(int(h * 0.62))
        for txt, cx in (("ma", x0 + w / 2), ("te", x0 + w + gap + w / 2)):
            tw = d.textlength(txt, font=f)
            d.text((cx - tw / 2, y0 + h * 0.12), txt, font=f, fill=INK)
    return img


def og():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # 카드
    rounded(d, (60, 60, W - 60, H - 60), 36, "#FFFFFF")
    # 덩어리 칩
    chips(d, 120, 130, ["ma", "te", "ri", "al"], 96, 26, 10, 10)
    # 제목
    d.text((120, 300), "시은이 영어 단어 연습", font=font(64), fill=INK)
    d.text((120, 392), "덩어리로 끊어 읽고, 틀린 것만 다시 풀어요", font=font(34), fill=INK2)
    # 힌트 마스크
    f = font(40)
    mask = "m _ _ e _ _ a l"
    tw = d.textlength(mask, font=f)
    rounded(d, (120, 470, 120 + tw + 48, 470 + 68), 16, HL)
    d.text((144, 478), mask, font=f, fill=INK)
    d.text((120 + tw + 72, 484), "앞의 4글자는 맞았어요", font=font(30), fill=INK2)
    return img


if __name__ == "__main__":
    icon(512).save(os.path.join(ROOT, "icon-512.png"))
    icon(192).save(os.path.join(ROOT, "icon-192.png"))
    icon(180).save(os.path.join(ROOT, "apple-touch-icon.png"))
    icon(32).save(os.path.join(ROOT, "favicon-32.png"))
    og().save(os.path.join(ROOT, "og.png"), optimize=True)
    print("written:", sorted(os.listdir(ROOT)))
