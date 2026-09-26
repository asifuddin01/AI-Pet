#!/usr/bin/env python3
"""Turn a short video clip into a transparent animated WebP for the desktop pet.

The pet's "Clips & animated images" character plays one image per state (idle, walk,
talk, ...). This script cuts the character out of a clip with an anime-trained
background-removal model, crops to her, and writes a looping animated WebP you can
import in Settings -> Character.

    ./scripts/make_sprite.sh clip.mov idle.webp --start 5.4 --end 6.6

(`make_sprite.sh` sets up a private Python environment with the dependencies on first run.)
Use --model u2net_human_seg for realistic or 3D-rendered footage.

Everything runs locally. Use footage you have the right to use; the outputs are
for your own desktop and don't belong in the repository.
"""

from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

try:
    import av
    from PIL import Image, ImageChops
    from rembg import new_session, remove
except ImportError as exc:  # pragma: no cover - friendly setup hint
    sys.exit(f"Missing dependency ({exc.name}). Run: pip install -r scripts/requirements-sprites.txt")

# Frames are cut out at this size; the model works at ~1024 px internally anyway.
WORK_MAX_SIDE = 1280
# Alpha at or below this is treated as background (removes faint halos).
ALPHA_FLOOR = 24


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", type=Path, help="video (mov/mp4/webm/gif) to convert")
    p.add_argument("output", type=Path, help="animated .webp to write")
    p.add_argument("--start", type=float, default=0.0, help="start time in seconds (default 0)")
    p.add_argument("--end", type=float, default=None, help="end time in seconds (default: start + 2)")
    p.add_argument("--fps", type=float, default=12.0, help="output frame rate (default 12)")
    p.add_argument("--height", type=int, default=360, help="output height in px (default 360)")
    p.add_argument(
        "--crop",
        type=str,
        default=None,
        help="only look at this region first, as x,y,w,h fractions of the frame (e.g. 0.3,0,0.5,1)",
    )
    p.add_argument(
        "--min-coverage",
        type=float,
        default=0.02,
        help="drop frames where less than this fraction of the frame is kept (default 0.02)",
    )
    p.add_argument(
        "--fade-edges",
        type=float,
        default=0.14,
        help="fade out this fraction where the shot cuts her off at the frame edge (0 = off, default 0.14)",
    )
    p.add_argument("--pingpong", action="store_true", help="play forward then backward for a seamless loop")
    p.add_argument("--quality", type=int, default=82, help="WebP quality 1-100 (default 82)")
    p.add_argument(
        "--model",
        default="isnet-anime",
        help="rembg model: isnet-anime (default, anime) or u2net_human_seg (realistic / 3D renders)",
    )
    p.add_argument("--frames-dir", type=Path, default=None, help="also save each cut-out frame as PNG here")
    args = p.parse_args(argv)
    if args.end is None:
        args.end = args.start + 2.0
    if args.end <= args.start:
        p.error("--end must be after --start")
    if args.output.suffix.lower() != ".webp":
        p.error("output must be a .webp file")
    if not 1 <= args.fps <= 30:
        p.error("--fps must be between 1 and 30")
    return args


def parse_crop(spec: str | None) -> tuple[float, float, float, float] | None:
    if not spec:
        return None
    try:
        x, y, w, h = (float(v) for v in spec.split(","))
    except ValueError:
        sys.exit("--crop must be four comma-separated numbers: x,y,w,h")
    if not (0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 - x + 1e-9 and 0 < h <= 1 - y + 1e-9):
        sys.exit("--crop values are fractions of the frame (0-1) and must stay inside it")
    return x, y, w, h


def read_frames(path: Path, start: float, end: float, fps: float) -> list[Image.Image]:
    """Decode frames in [start, end) sampled at `fps`."""
    frames: list[Image.Image] = []
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        if start > 0 and stream.time_base:
            container.seek(int(start / stream.time_base), stream=stream, backward=True)
        next_t = start
        step = 1.0 / fps
        for frame in container.decode(stream):
            if frame.time is None or frame.time < next_t - 1e-6:
                continue
            if frame.time >= end:
                break
            frames.append(frame.to_image())
            next_t += step
            # Skip ahead if the source is slower than the requested fps.
            while next_t <= frame.time:
                next_t += step
    return frames


def shrink(img: Image.Image, max_side: int) -> Image.Image:
    scale = max_side / max(img.size)
    if scale >= 1:
        return img
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def clean_alpha(img: Image.Image) -> Image.Image:
    r, g, b, a = img.split()
    a = a.point(lambda v: 0 if v <= ALPHA_FLOOR else v)
    return Image.merge("RGBA", (r, g, b, a))


def coverage(img: Image.Image) -> float:
    hist = img.getchannel("A").histogram()
    kept = sum(hist[128:])
    return kept / (img.width * img.height)


def union_bbox(frames: list[Image.Image], pad: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = frames[0].width, frames[0].height, 0, 0
    for f in frames:
        box = f.getchannel("A").getbbox()
        if not box:
            continue
        left, top = min(left, box[0]), min(top, box[1])
        right, bottom = max(right, box[2]), max(bottom, box[3])
    w, h = frames[0].size
    return max(0, left - pad), max(0, top - pad), min(w, right + pad), min(h, bottom + pad)


def cut_edges(frames: list[Image.Image], box: tuple[int, int, int, int]) -> set[str]:
    """Frame edges the character runs off (a close-up cut at the waist, say). The top is
    left alone: fading the top of her head looks worse than a clean cut."""
    w, h = frames[0].size
    edges = set()
    if box[0] <= 2:
        edges.add("left")
    if box[2] >= w - 2:
        edges.add("right")
    if box[3] >= h - 2:
        edges.add("bottom")
    return edges


def fade_mask(size: tuple[int, int], edges: set[str], frac: float) -> Image.Image:
    """Alpha mask that fades out towards `edges`, hiding hard straight cut lines."""
    w, h = size
    mask = Image.new("L", size, 255)
    ramp = Image.linear_gradient("L")  # black at the top -> white at the bottom
    for edge in edges:
        if edge in ("top", "bottom"):
            n = max(1, round(h * frac))
            g = ramp if edge == "top" else ramp.transpose(Image.FLIP_TOP_BOTTOM)
            pos = (0, 0) if edge == "top" else (0, h - n)
            region = (pos[0], pos[1], pos[0] + w, pos[1] + n)
            mask.paste(ImageChops.multiply(mask.crop(region), g.resize((w, n))), pos)
        else:
            n = max(1, round(w * frac * 0.6))
            g = ramp.rotate(90) if edge == "left" else ramp.rotate(-90)
            pos = (0, 0) if edge == "left" else (w - n, 0)
            region = (pos[0], pos[1], pos[0] + n, pos[1] + h)
            mask.paste(ImageChops.multiply(mask.crop(region), g.resize((n, h))), pos)
    return mask


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    crop = parse_crop(args.crop)
    if not args.input.is_file():
        sys.exit(f"No such file: {args.input}")

    print(f"Reading {args.input.name} {args.start:.2f}s-{args.end:.2f}s at {args.fps:g} fps…")
    frames = read_frames(args.input, args.start, args.end, args.fps)
    if not frames:
        sys.exit("No frames in that time range.")

    session = new_session(args.model)
    cut: list[tuple[int, Image.Image, float]] = []
    for i, frame in enumerate(frames):
        if crop:
            x, y, w, h = crop
            fw, fh = frame.size
            frame = frame.crop((round(x * fw), round(y * fh), round((x + w) * fw), round((y + h) * fh)))
        rgba = clean_alpha(remove(shrink(frame.convert("RGB"), WORK_MAX_SIDE), session=session).convert("RGBA"))
        cov = coverage(rgba)
        cut.append((i, rgba, cov))
        print(f"  frame {i + 1:3d}/{len(frames)}  kept {cov * 100:5.1f}%", end="\r", flush=True)
    print()

    # Blurry or heavily stylised frames sometimes come back almost empty: drop them.
    median = statistics.median(c for _, _, c in cut)
    keep = [(i, img) for i, img, c in cut if c >= args.min_coverage and c >= median * 0.5]
    dropped = len(cut) - len(keep)
    if dropped:
        print(f"Dropped {dropped} frame(s) where the cut-out failed.")
    if len(keep) < 2:
        sys.exit("Too few usable frames. Try another time range, --crop, or a lower --min-coverage.")

    if median > 0.9:
        print("Note: almost the whole frame was kept, so the background may still be there. "
              "Try a shot where she's smaller in frame, or --crop.")

    images = [img for _, img in keep]
    tight = union_bbox(images, pad=0)
    edges = cut_edges(images, tight) if args.fade_edges > 0 else set()
    box = union_bbox(images, pad=max(4, images[0].height // 100))
    images = [img.crop(box) for img in images]
    if edges:
        mask = fade_mask(images[0].size, edges, args.fade_edges)
        for n, img in enumerate(images):
            img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
            images[n] = img
        print(f"Softened the {', '.join(sorted(edges))} edge(s) where the shot cuts her off.")
    scale = args.height / images[0].height
    size = (max(1, round(images[0].width * scale)), args.height)
    images = [img.resize(size, Image.LANCZOS) for img in images]

    if args.frames_dir:
        args.frames_dir.mkdir(parents=True, exist_ok=True)
        for n, img in enumerate(images):
            img.save(args.frames_dir / f"frame_{n:03d}.png")

    if args.pingpong and len(images) > 2:
        images = images + images[-2:0:-1]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(
        args.output,
        save_all=True,
        append_images=images[1:],
        duration=round(1000 / args.fps),
        loop=0,
        quality=args.quality,
        method=5,
        background=(0, 0, 0, 0),
    )
    kb = args.output.stat().st_size / 1024
    print(f"Wrote {args.output} — {len(images)} frames, {size[0]}×{size[1]}, {kb:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
