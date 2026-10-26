"""Generates Wedding · Wizard's artwork: parchment sheets, the night castle,
the candle-lit library and the wax seal. Everything is drawn here from
noise and shapes; no third-party art.

Usage:
    python tools/wizard_art.py <out-dir>

wedding-wizard/images/*.webp were made from this output (backgrounds and
parchments as-is, the seal at 400px, the tall parchment at 600x1250).
Photo-quality art can replace any of them under the same file name."""
import os, sys, math
import numpy as np
import cv2

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def fnoise(h, w, octaves=6, base=4, persist=0.55, seed=None, aniso=1.0):
    r = np.random.default_rng(seed) if seed is not None else rng
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        f = base * (2 ** o)
        gh, gw = max(2, int(f)), max(2, int(f * w / h * aniso))
        g = r.random((gh, gw)).astype(np.float32)
        acc += amp * cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= persist
    acc /= tot
    acc -= acc.min(); acc /= max(acc.max(), 1e-6)
    return acc


def hexc(s):
    s = s.lstrip('#')
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def lerp(a, b, t):
    return a + (b - a) * t[..., None]


def save_rgb(img, name, q=86):
    bgr = cv2.cvtColor((np.clip(img, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    cv2.imwrite(os.path.join(OUT, name), bgr, [cv2.IMWRITE_JPEG_QUALITY, q])


def save_rgba(img, alpha, name):
    rgba = np.dstack([np.clip(img, 0, 1), np.clip(alpha, 0, 1)])
    bgra = cv2.cvtColor((rgba * 255).astype(np.uint8), cv2.COLOR_RGBA2BGRA)
    cv2.imwrite(os.path.join(OUT, name), bgra, [cv2.IMWRITE_PNG_COMPRESSION, 9])


def glow(canvas, x, y, radius, color, strength):
    h, w = canvas.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    d2 = ((xx - x) ** 2 + (yy - y) ** 2) / (radius ** 2)
    canvas += np.exp(-d2)[..., None] * hexc(color) * strength


# ---------------------------------------------------------------- parchment
def parchment(w, h, seed, burn=1.0, name='parch.png', torn=True):
    r = np.random.default_rng(seed)
    low = fnoise(h, w, 5, 3, 0.6, seed)
    mid = fnoise(h, w, 4, 14, 0.5, seed + 1)
    fib = fnoise(h, w, 3, 60, 0.5, seed + 2, aniso=0.25)  # horizontal fibres
    grain = r.random((h, w)).astype(np.float32)
    t = 0.55 * low + 0.25 * mid + 0.12 * fib + 0.08 * grain
    img = lerp(hexc('#efd8a6'), hexc('#a8783f'), np.clip((t - 0.2) * 1.6, 0, 1) ** 1.2)
    blot = np.clip((fnoise(h, w, 4, 8, 0.55, seed + 3) - 0.55) * 3, 0, 1)
    img = lerp(img, hexc('#9c6a34'), blot * 0.35)
    # water / tea stains with darker rims
    for _ in range(int(3 + w * h / 160000)):
        cx, cy = r.random() * w, r.random() * h
        rad = (0.08 + r.random() * 0.18) * min(w, h)
        yy, xx = np.ogrid[:h, :w]
        n = fnoise(h, w, 3, 6, 0.5, int(r.integers(1_000_000)))
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / rad + (n - 0.5) * 0.7
        inside = np.clip(1 - d, 0, 1) ** 0.6
        rim = np.exp(-((d - 1) ** 2) / 0.012)
        img = lerp(img, hexc('#9a6534'), 0.10 * inside + 0.22 * rim)
    # foxing specks
    for _ in range(int(w * h / 9000)):
        x, y = int(r.random() * w), int(r.random() * h)
        cv2.circle(img, (x, y), int(1 + r.random() * 2), (hexc('#8a5a2b') * (0.9 + 0.2 * r.random())).tolist(), -1)
    img = cv2.GaussianBlur(img, (0, 0), 0.6)
    # burnt / aged edges
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy])
    en = fnoise(h, w, 5, 6, 0.6, seed + 9)
    ed = edge + (en - 0.5) * 0.09 * min(w, h) * burn
    scale = 0.06 * min(w, h)
    age = np.clip(1 - ed / (scale * 1.6), 0, 1)
    img = lerp(img, hexc('#7a4a1e'), age ** 1.4 * 0.75)
    char = np.clip(1 - ed / (scale * 0.55), 0, 1)
    img = lerp(img, hexc('#2a150a'), char ** 1.2 * burn)
    if torn:
        alpha = np.clip((ed - scale * 0.12) / 2.0, 0, 1)
    else:
        alpha = np.ones((h, w), np.float32)
    save_rgba(img, alpha, name)


# ---------------------------------------------------------------- flame / candle helpers
def candle(img, x, y, cw, ch, flame=1.0):
    """Cream wax candle, base at (x, y)."""
    x0, x1 = int(x - cw / 2), int(x + cw / 2)
    top = int(y - ch)
    for i in range(x0, x1):
        t = (i - x0) / max(1, x1 - x0)
        shade = 0.55 + 0.45 * math.sin(t * math.pi) ** 0.6
        col = hexc('#efe2c4') * shade
        img[max(top, 0):int(y), max(i, 0):i + 1] = col
    # drips + warm top
    cv2.ellipse(img, (int(x), top), (int(cw / 2), max(2, int(cw / 6))), 0, 0, 360, (hexc('#fff3d6')).tolist(), -1)
    fh = cw * 1.6 * flame
    pts = np.array([[x, top - fh], [x + cw * 0.22, top - fh * 0.35], [x, top - 1], [x - cw * 0.22, top - fh * 0.35]], np.int32)
    cv2.fillPoly(img, [pts], hexc('#ffd27a').tolist())
    cv2.ellipse(img, (int(x), int(top - fh * 0.3)), (max(1, int(cw * 0.1)), max(2, int(fh * 0.22))), 0, 0, 360, hexc('#fffbe8').tolist(), -1)
    return (x, top - fh * 0.45)


def add_glows(img, pts, radius, color, strength):
    acc = np.zeros_like(img)
    h, w = img.shape[:2]
    for (gx, gy, s) in pts:
        cv2.circle(acc, (int(gx), int(gy)), max(1, int(radius * s)), hexc(color).tolist(), -1)
    acc = cv2.GaussianBlur(acc, (0, 0), radius * 0.9)
    img += acc * strength
    acc2 = np.zeros_like(img)
    for (gx, gy, s) in pts:
        cv2.circle(acc2, (int(gx), int(gy)), max(1, int(radius * 3 * s)), hexc(color).tolist(), -1)
    img += cv2.GaussianBlur(acc2, (0, 0), radius * 3) * strength * 0.35


def unit(w, h):
    """Drawing scale: 1.0 on the 780x1688 phone art. Wide art scales by its
    height, so a widescreen castle or bookshelf isn't drawn giant."""
    return min(w, h * 780 / 1688) / 780


def vignette(img, k=1.0):
    h, w = img.shape[:2]
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    return img * np.clip(1 - 0.55 * k * np.clip(d - 0.35, 0, 2) ** 1.3, 0.05, 1)[..., None]


def film_grain(img, amt=0.035, seed=3):
    r = np.random.default_rng(seed)
    return img + (r.random(img.shape[:2]).astype(np.float32)[..., None] - 0.5) * amt


# ---------------------------------------------------------------- night castle
def castle_silhouette(mask_img, base_y, cx, width, r, lit, scale=1.0):
    h, w = mask_img.shape
    towers = []
    n = 13
    for i in range(n):
        tx = cx - width / 2 + width * (i + r.random() * 0.6) / n
        tw = (10 + r.random() * 18) * scale
        th = (60 + r.random() * 170) * scale * (1.25 - abs(tx - cx) / width)
        towers.append((tx, tw, th))
    towers.append((cx, 26 * scale, 290 * scale))  # keep
    for tx, tw, th in sorted(towers, key=lambda t: -t[2]):
        x0, x1 = int(tx - tw), int(tx + tw)
        top = int(base_y - th)
        cv2.rectangle(mask_img, (x0, top), (x1, int(base_y + 80 * scale)), 1.0, -1)
        roof = int(th * (0.28 + r.random() * 0.2))
        cv2.fillPoly(mask_img, [np.array([[x0 - 3, top], [x1 + 3, top], [int(tx), top - roof]], np.int32)], 1.0)
        for _ in range(int(th / 22)):
            if r.random() < 0.65:
                wx = int(tx + (r.random() - 0.5) * tw * 1.2)
                wy = int(top + 12 + r.random() * (th - 20))
                lit.append((wx, wy, 0.6 + r.random() * 0.6))
    # walls between towers
    cv2.rectangle(mask_img, (int(cx - width / 2), int(base_y - 70 * scale)), (int(cx + width / 2), int(base_y)), 1.0, -1)
    for i in range(int(width / 9)):
        if i % 2 == 0:
            x = int(cx - width / 2 + i * 9)
            cv2.rectangle(mask_img, (x, int(base_y - 70 * scale - 7)), (x + 5, int(base_y - 70 * scale)), 1.0, -1)


def night_castle(w, h, name, moon=(0.78, 0.12), castle_y=0.5, cx=0.5, cwidth=0.95, seed=11):
    r = np.random.default_rng(seed)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    sky = lerp(hexc('#070b18'), hexc('#1d2740'), np.clip(yy / castle_y, 0, 1) ** 1.6)
    clouds = fnoise(h, w, 6, 3, 0.55, seed, aniso=0.5)
    sky += (np.clip(clouds - 0.45, 0, 1) * 0.22)[..., None] * hexc('#5a6a8c')
    # stars
    for _ in range(int(w * h / 2500)):
        x, y = int(r.random() * w), int(r.random() * h * castle_y * 0.9)
        b = r.random() ** 3
        sky[y, x] += b * 0.9
    sky = cv2.GaussianBlur(sky, (0, 0), 0.5)
    mx, my = moon[0] * w, moon[1] * h
    glow(sky, mx, my, w * 0.28, '#7f8db0', 0.45)
    glow(sky, mx, my, w * 0.09, '#cfd7ea', 0.6)
    yy2, xx2 = np.ogrid[:h, :w]
    mr = w * 0.055
    md = np.sqrt((xx2 - mx) ** 2 + (yy2 - my) ** 2)
    mtex = fnoise(h, w, 4, 30, 0.5, seed + 4)
    mm = np.clip((mr - md) / 1.5, 0, 1)
    moonc = lerp(hexc('#c7c9c4'), hexc('#fbf7ea'), mtex)
    sky = sky * (1 - mm[..., None]) + moonc * mm[..., None]
    # warm horizon haze
    hz = np.exp(-((yy - castle_y) ** 2) / 0.004)
    sky += hz[..., None] * hexc('#e0913d') * 0.18
    # cliff + castle
    base = castle_y * h
    mask = np.zeros((h, w), np.float32)
    lit = []
    castle_silhouette(mask, base, cx * w, cwidth * w * 0.75, r, lit, scale=1.45 * unit(w, h))
    ridge = fnoise(1, w, 5, 3, 0.6, seed + 5)[0]
    for x in range(w):
        ry = int(base - 30 + ridge[x] * 22 + h * 0.16 * ((x - cx * w) / (w * 0.6)) ** 2)
        mask[ry:int(h * (castle_y + 0.12)), x] = 1.0
    mask = cv2.GaussianBlur(mask, (0, 0), 0.8)
    stone = lerp(hexc('#07080d'), hexc('#12141b'), fnoise(h, w, 4, 20, 0.5, seed + 6))
    img = sky * (1 - mask[..., None]) + stone * mask[..., None]
    for (wx, wy, s) in lit:
        cv2.rectangle(img, (wx - 2, wy - 4), (wx + 2, wy + 4), hexc('#ffcf7a').tolist(), -1)
    add_glows(img, lit, 6, '#ffb24d', 0.55)
    # lake with reflection
    wl = int(h * (castle_y + 0.12))
    refl = img[max(0, 2 * wl - h):wl][::-1].copy()
    refl = cv2.resize(refl, (w, h - wl))
    ripple = fnoise(h - wl, w, 4, 40, 0.5, seed + 7, aniso=0.08)
    shift = ((ripple - 0.5) * 18).astype(np.float32)
    mapx = (np.arange(w, dtype=np.float32)[None, :] + shift)
    mapy = np.repeat(np.arange(h - wl, dtype=np.float32)[:, None], w, 1)
    refl = cv2.remap(refl, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    fade = np.exp(-np.arange(h - wl, dtype=np.float32) / (h * 0.12))[:, None, None]
    refl = cv2.GaussianBlur(refl, (0, 0), 1.5) * 0.5 * fade + hexc('#05070d') * (1 - 0.5 * fade)
    img[wl:] = refl
    # floating candles in sky
    pts = []
    for _ in range(18):
        x, y = r.random() * w, (0.06 + r.random() * 0.8) * h * castle_y
        s = 0.4 + r.random() * 0.8
        fx, fy = candle(img, x, y, 7 * s * unit(w, h), 30 * s * unit(w, h))
        pts.append((fx, fy, s))
    add_glows(img, pts, 9 * unit(w, h), '#ffb44f', 0.8)
    img = vignette(img, 1.0)
    img = film_grain(img, 0.03, seed)
    save_rgb(img, name)


# ---------------------------------------------------------------- candle-lit library
def library(w, h, name, seed=21, candles_at=None):
    r = np.random.default_rng(seed)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    img = lerp(hexc('#1a0f08'), hexc('#0b0705'), yy)
    # shelves with books
    shelf_h = int(150 * unit(w, h))
    palette = ['#4a1c14', '#2c3a24', '#3a2a18', '#5a3a1c', '#22293a', '#6a4a24', '#3d1a1a', '#4b3b2a']
    for sy in range(int(h * 0.02), int(h * 0.82), shelf_h):
        x = -r.random() * 20
        while x < w:
            bw = (14 + r.random() * 24) * unit(w, h)
            bh = shelf_h * (0.62 + r.random() * 0.3)
            col = hexc(palette[int(r.integers(len(palette)))]) * (0.55 + r.random() * 0.5)
            x0, x1 = int(x), int(x + bw)
            cv2.rectangle(img, (x0, int(sy + shelf_h - bh)), (x1, sy + shelf_h - 6), col.tolist(), -1)
            if r.random() < 0.6:
                gy = int(sy + shelf_h - bh * (0.2 + r.random() * 0.5))
                cv2.line(img, (x0 + 2, gy), (x1 - 2, gy), (hexc('#b8893e') * 0.7).tolist(), 1)
            cv2.line(img, (x0, int(sy + shelf_h - bh)), (x0, sy + shelf_h - 6), (col * 0.5).tolist(), 1)
            x += bw + r.random() * 3
        cv2.rectangle(img, (0, sy + shelf_h - 6), (w, sy + shelf_h + 4), hexc('#2a1a0e').tolist(), -1)
    wood = fnoise(h, w, 4, 30, 0.5, seed, aniso=0.1)
    img *= (0.8 + 0.4 * wood)[..., None]
    img *= 0.55
    # candles
    pts = []
    spots = candles_at or [(r.random(), 0.25 + r.random() * 0.7, 0.6 + r.random() * 0.9) for _ in range(9)]
    for (fx, fy, s) in spots:
        cx, cy = fx * w, fy * h
        px, py = candle(img, cx, cy, 16 * s * unit(w, h), 90 * s * unit(w, h))
        pts.append((px, py, s))
    add_glows(img, pts, 22 * unit(w, h), '#ff9d3a', 1.3)
    # warm light pooling
    for (px, py, s) in pts:
        glow(img, px, py, 312 * unit(w, h) * s, '#9a5418', 0.5)
    # bokeh
    bok = np.zeros_like(img)
    for _ in range(26):
        x, y = int(r.random() * w), int(r.random() * h)
        cv2.circle(bok, (x, y), int((6 + r.random() * 22) * unit(w, h)), (hexc('#ffb35c') * (0.3 + r.random() * 0.7)).tolist(), -1)
    img += cv2.GaussianBlur(bok, (0, 0), 3) * 0.25
    img = vignette(img, 1.2)
    img = film_grain(img, 0.03, seed)
    save_rgb(img, name)


# ---------------------------------------------------------------- wax seal
def wax_seal(s, name, seed=31):
    h = w = s
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    c = s / 2
    ang = np.arctan2(yy - c, xx - c)
    dist = np.sqrt((xx - c) ** 2 + (yy - c) ** 2)
    r = np.random.default_rng(seed)
    wob = np.zeros_like(ang)
    for k in range(3, 14):
        wob += r.normal() / k * np.cos(k * ang + r.random() * 6.28)
    R = s * 0.43 * (1 + 0.06 * wob)
    t = dist / R
    blob = np.clip((R - dist) / 1.5, 0, 1)
    # height field: puddle with raised rim + inner pressed disc
    inner = s * 0.31
    hgt = np.clip(1 - t, 0, 1) ** 0.35 * 0.6
    hgt += 0.35 * np.exp(-((dist - inner) ** 2) / (s * 0.012) ** 2)  # rim of stamp
    hgt -= 0.12 * np.clip((inner - dist) / 3, 0, 1)  # pressed centre
    hgt += 0.02 * fnoise(h, w, 4, 12, 0.5, seed)
    hgt = cv2.GaussianBlur(hgt.astype(np.float32), (0, 0), s * 0.004)
    gy, gx = np.gradient(hgt * s * 0.25)
    nz = np.ones_like(gx)
    n = np.dstack([-gx, -gy, nz]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    L = np.array([-0.5, -0.6, 0.62]); L /= np.linalg.norm(L)
    diff = np.clip((n * L).sum(2), 0, 1)
    H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
    spec = np.clip((n * H).sum(2), 0, 1) ** 40
    base = lerp(hexc('#4a0a0c'), hexc('#a8201f'), diff)
    img = base + spec[..., None] * 0.55
    # star ring decoration
    ring = np.zeros((h, w), np.float32)
    for i in range(12):
        a = i / 12 * 2 * math.pi
        px, py = c + math.cos(a) * s * 0.36, c + math.sin(a) * s * 0.36
        cv2.circle(ring, (int(px), int(py)), max(1, int(s * 0.007)), 1.0, -1)
    img = img * (1 - 0.35 * ring[..., None]) + hexc('#d8a24a') * ring[..., None] * 0.35
    # soft shadow
    shadow = cv2.GaussianBlur(np.roll(np.roll(blob, int(s * 0.02), 0), int(s * 0.015), 1), (0, 0), s * 0.02)
    alpha = np.maximum(blob, shadow * 0.55)
    img = img * blob[..., None]
    img = img / np.maximum(alpha[..., None], 1e-4)
    save_rgba(img, alpha, name)


if __name__ == '__main__':
    W, H = 780, 1688
    parchment(700, 980, 101, 1.0, 'parch-letter.png')
    parchment(700, 560, 102, 0.9, 'parch-card.png')
    parchment(720, 520, 103, 1.0, 'parch-map.png')
    parchment(520, 520, 104, 0.6, 'parch-square.png')
    parchment(720, 1500, 105, 0.7, 'parch-tall.png')
    night_castle(W, H, 'night-castle.jpg', castle_y=0.42)
    night_castle(W, H, 'night-castle-low.jpg', moon=(0.25, 0.1), castle_y=0.62, cx=0.55, cwidth=1.1, seed=12)
    library(W, H, 'library.jpg', 21, [(0.12, 0.28, 0.9), (0.88, 0.22, 0.7), (0.08, 0.95, 1.4), (0.92, 0.9, 1.1), (0.78, 0.97, 0.7)])
    library(W, H, 'library-2.jpg', 22, [(0.9, 0.3, 0.9), (0.1, 0.2, 0.6), (0.85, 0.96, 1.4), (0.15, 0.92, 1.0)])
    wax_seal(600, 'wax-seal.png')
    print('ok', sorted(os.listdir(OUT)))
