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


CHEEK = "#FF9DB3"


def face(size, with_bg=True):
    """노란 힌트 칩에 얼굴을 붙인 캐릭터 (favicon.svg 와 같은 도안). RGBA size×size.
    with_bg=False 면 파란 바탕 없이 얼굴만 (OG 카드에 얹을 때).
    작은 크기에서도 눈·입이 읽히도록 4배로 그려서 줄인다."""
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = S / 64  # favicon.svg 의 64 단위 좌표를 그대로 쓴다
    if with_bg:
        rounded(d, (0, 0, S, S), 15 * u, ACC)
    rounded(d, (7 * u, 13 * u, 57 * u, 53 * u), 14 * u, HL)

    def dot(cx, cy, r, fill):
        d.ellipse((cx * u - r * u, cy * u - r * u, cx * u + r * u, cy * u + r * u), fill=fill)

    # 볼
    dot(17, 38, 3.6, CHEEK)
    dot(47, 38, 3.6, CHEEK)
    # 눈 + 반짝임
    dot(24, 30, 3.8, INK)
    dot(40, 30, 3.8, INK)
    dot(25.3, 28.8, 1.2, "#FFFFFF")
    dot(41.3, 28.8, 1.2, "#FFFFFF")
    # 입 (M25 39 Q32 46 39 39 와 같은 호)
    d.arc((25 * u, 33.5 * u, 39 * u, 44.5 * u), start=15, end=165, fill=INK, width=int(3.2 * u))
    for cx, cy in ((25, 39), (39, 39)):
        dot(cx, cy, 1.6, INK)

    return img.resize((size, size), Image.LANCZOS)


def icon(size):
    """앱 아이콘 = 파란 바탕 + 얼굴"""
    return face(size, with_bg=True)


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
    # 오른쪽에 얼굴 캐릭터 (파란 바탕 없이)
    fc = face(300, with_bg=False)
    img.paste(fc, (W - 60 - 300 - 20, (H - 300) // 2 + 10), fc)
    return img


if __name__ == "__main__":
    icon(512).save(os.path.join(ROOT, "icon-512.png"))
    icon(192).save(os.path.join(ROOT, "icon-192.png"))
    icon(180).save(os.path.join(ROOT, "apple-touch-icon.png"))
    icon(32).save(os.path.join(ROOT, "favicon-32.png"))
    og().save(os.path.join(ROOT, "og.png"), optimize=True)
    print("written:", sorted(os.listdir(ROOT)))
