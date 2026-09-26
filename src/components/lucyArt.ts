/**
 * The pet's artwork: a Lucy (Cyberpunk: Edgerunners) inspired fan-art figure, drawn as
 * layered vector parts. Every part shares one 120×120 coordinate space so the layers
 * line up; each sits in its own element so CSS can animate it with compositor-only
 * transforms (legs walk, arms wave, head tilts, eyes blink).
 *
 * Clothing is rendered from an `Outfit` (see `pet/Wardrobe.ts`). Right-hand parts are
 * the left ones mirrored around x = 60.
 */
import type { Outfit } from "../pet/Wardrobe";

export const ART_SIZE = 120;

const INK = "#1b1829";

const svg = (body: string) =>
  `<svg viewBox="0 0 ${ART_SIZE} ${ART_SIZE}" aria-hidden="true" focusable="false">${body}</svg>`;
const mirror = (body: string) => `<g transform="matrix(-1 0 0 1 ${ART_SIZE} 0)">${body}</g>`;
const stops = (colors: readonly string[]) =>
  colors.map((c, i) => `<stop offset="${[0, 0.42, 0.64, 0.8, 1][i]}" stop-color="${c}"/>`).join("");

/** Gradients shared by all parts; re-rendered when the outfit changes. */
export function renderDefs(o: Outfit): string {
  const j = o.jacket ?? { from: "#ffffff", to: "#d9d6ec" };
  const sleeve = o.jacket?.sleeve ?? [j.from, j.to];
  return `<defs>
  <linearGradient id="lucy-hair" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="32">${stops(o.hair.front)}</linearGradient>
  <linearGradient id="lucy-hair-back" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="33">${stops(o.hair.back)}</linearGradient>
  <linearGradient id="lucy-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffeee7"/><stop offset="1" stop-color="#f9d4c6"/></linearGradient>
  <linearGradient id="lucy-iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f2b66"/><stop offset=".55" stop-color="#6b80d4"/><stop offset="1" stop-color="#d9c2ff"/></linearGradient>
  <linearGradient id="lucy-top" gradientUnits="userSpaceOnUse" x1="0" y1="34" x2="0" y2="72"><stop offset="0" stop-color="${o.top.from}"/><stop offset="1" stop-color="${o.top.to}"/></linearGradient>
  <linearGradient id="lucy-jacket" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${j.from}"/><stop offset="1" stop-color="${j.to}"/></linearGradient>
  <linearGradient id="lucy-sleeve" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${sleeve[0]}"/><stop offset="1" stop-color="${sleeve[1]}"/></linearGradient>
  <linearGradient id="lucy-legwear" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${o.legs.color}"/><stop offset=".55" stop-color="${shade(o.legs.color)}"/><stop offset="1" stop-color="${o.legs.color}"/></linearGradient>
</defs>`;
}

/** A slightly lighter tone for the shine down the middle of legwear. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lift = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.14));
  const r = lift(n >> 16);
  const g = lift((n >> 8) & 0xff);
  const b = lift(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ------------------------------------------------------------------ shared shapes

// Narrow shoulders, defined waist, wide hips: 20 → 13 → 26 units.
const TORSO =
  "M54.6 35.6 L65.4 35.6 C67.8 36 69.6 37.4 70 39.6 C70.4 42.6 69.6 45.4 68.6 47.8 C67.6 50.4 66.6 52.6 66.4 55 " +
  "L66.8 59 L53.2 59 L53.6 55 C53.4 52.6 52.4 50.4 51.4 47.8 C50.4 45.4 49.6 42.6 50 39.6 C50.4 37.4 52.2 36 54.6 35.6 Z";
const HIPS =
  "M53.2 58.2 L66.8 58.2 C69.5 59.5 72 61.5 72.6 64.8 L73 66.4 C68 67.4 63.6 69 60 70.6 C56.4 69 52 67.4 47 66.4 " +
  "L47.4 64.8 C48 61.5 50.5 59.5 53.2 58.2 Z";
const SHORTS =
  "M53.2 58.2 L66.8 58.2 C69.5 59.5 72 61.5 72.6 64.8 L73 70 L62.6 70.6 L60 66.4 L57.4 70.6 L47 70 " +
  "L47.4 64.8 C48 61.5 50.5 59.5 53.2 58.2 Z";
const SKIRT = "M53.2 58.2 L66.8 58.2 C70.2 60 73.6 66 75.2 72.6 L44.8 72.6 C46.4 66 49.8 60 53.2 58.2 Z";
const DRESS =
  "M54.6 35.6 L65.4 35.6 C67.8 36 69.6 37.4 70 39.6 C70.4 42.6 69.6 45.4 68.6 47.8 C67.6 50.4 66.6 52.6 66.4 55 " +
  "C68.6 58 73 64.5 75.4 79 L44.6 79 C47 64.5 51.4 58 53.6 55 C53.4 52.6 52.4 50.4 51.4 47.8 C50.4 45.4 49.6 42.6 50 39.6 " +
  "C50.4 37.4 52.2 36 54.6 35.6 Z";
const LEG_SKIN =
  "M47.4 64 C47 71.5 48.2 79 50.2 85.5 C51.5 90.5 52.8 98 53.9 106.4 L57.4 106.4 C57.3 99 57.7 91.5 57.9 86 " +
  "C58.2 80 59.3 73.5 59.8 69 L60 64 Z";
const THIGH_HIGH =
  "M48.3 75 C48.9 78.8 49.4 82.3 50.2 85.5 C51.5 90.5 52.8 98 53.9 106.4 L57.4 106.4 C57.3 99 57.7 91.5 57.9 86 " +
  "C58.2 82 58.6 78.3 59.1 75 Z";
const KNEE_DOWN = "M51 88.4 C51.9 93.8 52.9 99.5 53.9 106.4 L57.4 106.4 C57.3 100.5 57.5 94.5 57.8 88.4 Z";

// ------------------------------------------------------------------ parts

function jacketBack(o: Outfit): string {
  const cables = o.extras.includes("cables")
    ? `<path d="M58.4 33.4 C50 38 38 44 33 58 C30.5 66 31 74 28 84" stroke="#141726" stroke-width="1.1" fill="none" stroke-linecap="round"/>
       <path d="M61.2 33.6 C54 40 44 47 40 60 C37.6 68 38.6 78 36.4 88" stroke="#1d2238" stroke-width=".9" fill="none" stroke-linecap="round"/>
       <circle cx="35.2" cy="54.6" r=".7" fill="${o.top.accent}"/><circle cx="41.2" cy="56.4" r=".6" fill="${o.top.accent}"/>`
    : "";
  return cables + jacketLayer(o);
}

function jacketLayer(o: Outfit): string {
  const j = o.jacket;
  if (!j) return "";
  const alpha = j.opacity ?? 1;
  switch (j.style) {
    case "cropped":
    case "leather":
      return `
        <path d="M46.6 40 C43 46.5 42.2 53.5 42.7 61 L77.3 61 C77.8 53.5 77 46.5 73.4 40 L66 37.4 L54 37.4 Z" fill="url(#lucy-jacket)"/>
        <path d="M50.4 41.2 C48.4 47 47.9 53.5 48.1 60.8 L71.9 60.8 C72.1 53.5 71.6 47 69.6 41.2 Z" fill="${j.lining}"/>`;
    case "hoodie":
      return `
        <path d="M49.6 39 C48.4 31 52.4 26.8 60 26.8 C67.6 26.8 71.6 31 70.4 39 Z" fill="url(#lucy-jacket)"/>
        <path d="M52.4 38 C52 32.5 55 30 60 30 C65 30 68 32.5 67.6 38 Z" fill="${j.lining}"/>`;
    case "coat":
      return `
        <path d="M45.6 40 C41 50 39.6 65 39.9 85 L80.1 85 C80.4 65 79 50 74.4 40 L66 37.4 L54 37.4 Z" fill="url(#lucy-jacket)"/>
        <path d="M49.6 41.4 C46.6 51 45.6 65 45.8 84.6 L74.2 84.6 C74.4 65 73.4 51 70.4 41.4 Z" fill="${j.lining}"/>
        <path d="M41.2 62 L45.8 62 M78.8 62 L74.2 62 M40.4 74 L45.8 74 M79.6 74 L74.2 74" stroke="${j.trim}" stroke-width=".5"/>`;
    case "raincoat":
      return `<g opacity="${alpha}">
        <path d="M49.6 39 C48.4 31 52.4 26.8 60 26.8 C67.6 26.8 71.6 31 70.4 39 Z" fill="url(#lucy-jacket)"/>
        <path d="M45.6 40 C41 50 39.6 65 39.9 85 L80.1 85 C80.4 65 79 50 74.4 40 L66 37.4 L54 37.4 Z" fill="url(#lucy-jacket)"/>
        <path d="M45.6 40 C41 50 39.6 65 39.9 85 M74.4 40 C79 50 80.4 65 80.1 85" stroke="${j.trim}" stroke-width=".6" fill="none"/>
      </g>`;
  }
}

const HAIR_BACK = `
  <path d="M48.8 20 C48 9.5 53.5 3.8 60 3.8 C66.5 3.8 72 9.5 71.2 20 L71.6 29.5 C71.7 32.2 69.4 33.3 67.9 31.5
    L66.6 30.5 C65.6 32.6 63 32.8 62.2 31 L60 30.2 L57.8 31 C57 32.8 54.4 32.6 53.4 30.5 L52.1 31.5
    C50.6 33.3 48.3 32.2 48.4 29.5 Z" fill="url(#lucy-hair-back)"/>`;

function legLeft(o: Outfit): string {
  const l = o.legs;
  let wear = "";
  let shoe = `
    <path d="M53.3 105.6 L57.9 105.6 C58.4 107.8 58 109.7 56.8 110.3 L52.4 110.3 C51.2 110.3 51.3 108.5 52.6 107.9 Z" fill="${l.shoe}"/>
    <path d="M57.2 108.2 L57.6 111.4" stroke="${l.shoe}" stroke-width="1" stroke-linecap="round"/>`;
  switch (l.style) {
    case "thighhigh":
      wear = `<path d="${THIGH_HIGH}" fill="url(#lucy-legwear)"/>
        <path d="M48.3 75 L59.1 75 L59 76.5 L48.6 76.6 Z" fill="${l.band}"/>
        <ellipse cx="54.4" cy="87" rx=".8" ry="2.4" fill="#ffffff" opacity=".12"/>`;
      if (o.bottom.style === "shorts" || o.bottom.style === "jeans") {
        wear += `<path d="M49.6 60.5 C49.2 65.5 49 70 49.3 75" stroke="${INK}" stroke-width=".55" fill="none"/>`;
      }
      break;
    case "tights":
      wear = `<path d="${LEG_SKIN}" fill="url(#lucy-legwear)"/>
        <ellipse cx="54.4" cy="87" rx=".8" ry="2.4" fill="#ffffff" opacity=".1"/>`;
      break;
    case "tights-boots":
      wear = `<path d="${LEG_SKIN}" fill="url(#lucy-legwear)"/>
        <ellipse cx="53.6" cy="78" rx=".9" ry="3.2" fill="#ffffff" opacity=".12"/>
        <path d="M50.3 87 C51.3 93 52.3 99.5 53.3 105.4 L58.1 105.4 C58 100 58.2 93.5 58.6 87 Z" fill="${l.shoe}"/>
        <path d="M50.1 87 L58.8 87 L58.7 89.6 L50.5 89.6 Z" fill="#26233a"/>
        <path d="M52.6 93.5 L57.9 93 M52.9 95.4 L57.9 94.9" stroke="${l.band}" stroke-width=".55"/>
        <path d="M53.3 101.6 L58 101.2" stroke="${l.band}" stroke-width=".45"/>`;
      shoe = `<path d="M52.4 105 L58.6 105 C59.4 107.4 59.3 109.6 58.3 110.8 L51.4 110.8 C50.4 110.8 50.4 108.6 51.8 107.8 Z" fill="${l.shoe}"/>
        <path d="M51.2 110.2 L58.6 110.2" stroke="#3a3650" stroke-width=".9" stroke-linecap="round"/>
        <path d="M55.4 106.2 L57.8 106" stroke="${l.band}" stroke-width=".5"/>`;
      break;
    case "socks":
      wear = `<path d="${KNEE_DOWN}" fill="${l.color}"/>
        <path d="M51 88.4 L57.8 88.4 L57.7 90.4 L51.3 90.4 Z" fill="${l.band}"/>`;
      shoe = `<ellipse cx="55.4" cy="108.4" rx="3.6" ry="2.2" fill="${l.shoe}"/>
        <ellipse cx="55.4" cy="107.6" rx="2.2" ry="1" fill="#ffffff" opacity=".45"/>`;
      break;
    case "sheer-boots":
      wear = `<path d="${LEG_SKIN}" fill="${l.color}" opacity=".42"/>
        <path d="M50.8 87.4 C51.8 93 52.8 99.5 53.9 106.4 L57.5 106.4 C57.4 100.5 57.6 94 57.9 87.4 Z" fill="${l.shoe}"/>
        <path d="M50.8 87.4 L57.9 87.4" stroke="#3a3650" stroke-width=".6"/>`;
      break;
    case "boots":
      wear = `<path d="M50.8 87.4 C51.8 93 52.8 99.5 53.9 106.4 L57.5 106.4 C57.4 100.5 57.6 94 57.9 87.4 Z" fill="${l.shoe}"/>
        <path d="M50.6 87.4 L58.1 87.4 L58 89.2 L50.9 89.2 Z" fill="${l.band}" opacity=".85"/>`;
      break;
    case "bare":
      shoe = `<path d="M53.4 106 L57.6 106 C58 107.8 57.6 109.4 56.6 110 L52.8 110 C51.8 110 51.8 108.6 52.8 108 Z" fill="url(#lucy-skin)"/>
        <path d="M52.8 108.2 L57.6 107.6 M54 106.4 L54.6 109.9" stroke="${l.shoe}" stroke-width=".7" stroke-linecap="round"/>
        <path d="M52.2 110.4 L57.4 110.4" stroke="${l.shoe}" stroke-width=".9" stroke-linecap="round"/>`;
      break;
  }
  const circuits = o.extras.includes("circuits")
    ? `<path d="M51.8 70 L53.2 84 L54.8 96 L55.6 104" stroke="${o.top.accent}" stroke-width=".4" fill="none" opacity=".85"/>`
    : "";
  return `<path d="${LEG_SKIN}" fill="url(#lucy-skin)"/>${wear}${circuits}${shoe}`;
}

function body(o: Outfit): string {
  const t = o.top;
  const hood = o.jacket?.style === "hoodie";
  const shoulders = hood
    ? ""
    : `<ellipse cx="52.2" cy="37.6" rx="2.6" ry="2" fill="url(#lucy-skin)"/>
       <ellipse cx="67.8" cy="37.6" rx="2.6" ry="2" fill="url(#lucy-skin)"/>`;
  const form = `
    <ellipse cx="56" cy="42.6" rx="2.1" ry="1.4" fill="${t.shine}" opacity=".4"/>
    <ellipse cx="64" cy="42.6" rx="2.1" ry="1.4" fill="${t.shine}" opacity=".4"/>
    <path d="M53.2 44.6 Q55.9 46.4 58.8 45.1 M61.2 45.1 Q64.1 46.4 66.8 44.6" stroke="#000" stroke-width=".45" fill="none" opacity=".35"/>`;
  const collar = `
    <path d="M57.3 31.4 L62.7 31.4 L63.1 35.6 L56.9 35.6 Z" fill="${t.style === "bodysuit" || t.style === "dress" ? INK : t.from}"/>
    <path d="M57.2 33.4 L62.8 33.4" stroke="${t.accent}" stroke-width=".5"/>`;
  const emblem = `<path d="M58.8 37.8 L61.2 37.8 L62 38.8 L61.2 39.8 L58.8 39.8 L58 38.8 Z" fill="${t.accent}"/>`;
  const lines = `<path d="M55.1 40.4 L57.2 43.6 M64.9 40.4 L62.8 43.6 M54 51.6 L54.6 56 M66 51.6 L65.4 56" stroke="${t.accent}" stroke-width=".45"/>`;

  let clothes = "";
  if (t.style === "dress") {
    clothes = `<path d="${DRESS}" fill="url(#lucy-top)"/>${form}
      <path d="M53.6 55 C56 56.2 64 56.2 66.4 55" stroke="${t.accent}" stroke-width=".6" fill="none"/>
      <path d="M44.6 79 L75.4 79" stroke="${t.accent}" stroke-width=".9"/>
      <path d="M50 66 L48.2 78.6 M60 58 L60 78.6 M70 66 L71.8 78.6" stroke="${t.shine}" stroke-width=".35" opacity=".8"/>
      ${collar}${emblem}`;
  } else {
    clothes = `<path d="${TORSO}" fill="url(#lucy-top)"/>${form}${collar}${emblem}${lines}`;
    if (t.style === "swimsuit") {
      clothes += `<path d="${HIPS}" fill="url(#lucy-top)"/>
        <path d="M47 66.4 C52 67.4 56.4 69 60 70.6 C63.6 69 68 67.4 73 66.4" stroke="${t.accent}" stroke-width=".6" fill="none"/>`;
    } else if (o.bottom.style === "none") {
      clothes += `<path d="${HIPS}" fill="url(#lucy-top)"/>`;
    }
  }
  if (o.extras.includes("circuits")) {
    clothes += `<path d="M55 41.5 L55 47 L57.6 49.6 L57.6 57 M65 41.5 L65 47 L62.4 49.6 L62.4 57 M60 40 L60 44" stroke="${t.accent}" stroke-width=".4" fill="none" opacity=".9"/>`;
  }

  let bottom = "";
  const b = o.bottom;
  if (t.style !== "dress" && (b.style === "shorts" || b.style === "jeans")) {
    bottom = `<path d="${SHORTS}" fill="${b.color}"/>
      <path d="M60 62 L60 66.4 M49.4 66 C51 64.4 52.4 63.6 54 63.4 M70.6 66 C69 64.4 67.6 63.6 66 63.4" stroke="${b.shade}" stroke-width=".5" fill="none"/>`;
  } else if (t.style !== "dress" && b.style === "skirt") {
    bottom = `<path d="${SKIRT}" fill="${b.color}"/>
      <path d="M50.5 62 L48.6 72.4 M55 60 L54 72.4 M60 60 L60 72.4 M65 60 L66 72.4 M69.5 62 L71.4 72.4" stroke="${b.shade}" stroke-width=".45"/>`;
  }
  if (t.style !== "dress" && b.style !== "none") {
    bottom += `<path d="M52.4 58 L67.6 58 L68.3 59.9 L51.7 59.9 Z" fill="${INK}"/>
      <rect x="59" y="57.7" width="2" height="2.5" rx=".4" fill="#cfcce0"/>`;
  }

  let front = "";
  const j = o.jacket;
  if (j?.style === "hoodie") {
    front = `
      <path d="M50.5 36.8 C47.5 37.5 46.3 40 46.2 44 C46 51 46.2 58 46.4 66.5 C51 67.8 69 67.8 73.6 66.5
        C73.8 58 74 51 73.8 44 C73.7 40 72.5 37.5 69.5 36.8 C66 38.5 54 38.5 50.5 36.8 Z" fill="url(#lucy-jacket)"/>
      <path d="M52 56.5 L68 56.5 L69.4 63.4 L50.6 63.4 Z" fill="${j.lining}"/>
      <path d="M46.4 65 C51 66.3 69 66.3 73.6 65" stroke="${j.lining}" stroke-width="1.2" fill="none"/>
      <path d="M57.6 38.2 L57.2 46 M62.4 38.2 L62.8 46" stroke="${j.trim}" stroke-width=".5" stroke-linecap="round"/>
      <circle cx="57.2" cy="46.3" r=".5" fill="${j.trim}"/><circle cx="62.8" cy="46.3" r=".5" fill="${j.trim}"/>`;
  } else if (j?.style === "raincoat") {
    const panel = `<path d="M51.2 37.4 C47.6 40 46.6 46 46.3 52 C45.9 62 44.2 74 43.2 85 L48.4 85 C49.8 72 51.6 62 53.6 55
        C53.1 50 51.6 44 53.6 37.8 Z" fill="url(#lucy-jacket)"/>
      <circle cx="51.4" cy="48" r=".45" fill="${j.trim}"/><circle cx="50.2" cy="58" r=".45" fill="${j.trim}"/>`;
    front = `<g opacity="${j.opacity ?? 1}">${panel}${mirror(panel)}</g>`;
  } else if (j?.style === "coat") {
    const panel = `<path d="M51.2 37.4 C47.6 40 46.6 46 46.3 52 C45.9 62 44.2 74 43.2 85 L48.4 85 C49.8 72 51.6 62 53.6 55
        C53.1 50 51.6 44 53.6 37.8 Z" fill="url(#lucy-jacket)"/>
      <path d="M53.6 37.8 C51.6 44 53.1 50 53.6 55 C51.6 62 49.8 72 48.4 85" stroke="${j.lining}" stroke-width=".8" fill="none"/>
      <path d="M46 60 L49.6 60.4 M45.2 70 L48.8 70.4" stroke="${j.trim}" stroke-width=".5"/>`;
    front = panel + mirror(panel);
  } else if (j?.style === "leather") {
    const panel = `<path d="M51.2 37.4 C49.6 39 49 42 49 45.5 L49.6 51 L52.4 50.4 C52 46 52.2 42 53.4 38.4 Z" fill="url(#lucy-jacket)"/>
      <path d="M52.4 50.4 C52 46 52.2 42 53.4 38.4" stroke="${j.trim}" stroke-width=".4" fill="none"/>`;
    front = panel + mirror(panel);
  }

  const pendant = o.extras.includes("pendant")
    ? `<path d="M57 35.2 Q60 36.6 63 35.2" stroke="${t.accent}" stroke-width=".5" fill="none"/>
       <path d="M60 36 L59.2 37.6 L60 39.8 L60.8 37.6 Z" fill="${t.accent}"/><circle cx="60" cy="36.4" r=".45" fill="#8f7cf0"/>`
    : "";
  return `<path d="M58.2 29 L61.8 29 L62 34 L58 34 Z" fill="#f2c7b8"/>${shoulders}${clothes}${bottom}${front}${pendant}`;
}

function armLeft(o: Outfit): string {
  const hand = `<ellipse cx="45.3" cy="64.3" rx="1.7" ry="2.1" fill="url(#lucy-skin)"/>`;
  const j = o.jacket;
  if (!j) {
    const glove = o.extras.includes("circuits")
      ? `<path d="M45.4 55 L48.4 55.4 L47.8 62 L45.1 61.7 Z" fill="${o.top.to}"/><path d="M46.6 55.6 L46.4 61" stroke="${o.top.accent}" stroke-width=".35"/>`
      : "";
    const fill = o.top.sleeves ? "url(#lucy-top)" : "url(#lucy-skin)";
    return `<path d="M51.1 38.4 C48.4 39.2 47.2 41.5 46.8 45 C46.1 50 45.4 56 45.3 62 L47.7 62.3 C48 57 48.6 51 49.4 46.5
        C49.9 44 50.8 41.6 51.4 40 Z" fill="${fill}"/>${glove}${hand}`;
  }
  switch (j.style) {
    case "hoodie":
      return `<path d="M51.6 37 C47 37.6 45 41 44.4 45.5 C43.6 51 42.8 57 42.6 62 L48 62.6 C48.4 57 49 51 50 47
          C50.6 44 51.6 41 52.6 39 Z" fill="url(#lucy-jacket)"/>
        <rect x="42.3" y="60.5" width="6" height="2.6" rx="1" fill="${j.lining}"/>
        <ellipse cx="45.3" cy="64" rx="1.5" ry="1.6" fill="url(#lucy-skin)"/>`;
    case "coat":
      return `<path d="M51.2 37.6 C46.4 38.2 44.6 41.5 44.2 45.2 C43.5 50.6 42.7 56.4 42.5 61.6 L48 62.2 C48.4 57 49 51 50 46.6
          C50.6 43.8 51.6 41 52.6 39.2 Z" fill="url(#lucy-sleeve)"/>
        <path d="M44.8 47 L49.4 47.8 M44 54 L48.8 54.6" stroke="${j.trim}" stroke-width=".45" opacity=".6"/>
        <rect x="42.2" y="60.4" width="6" height="2.5" rx="1" fill="${j.to}"/>${hand}`;
    case "raincoat":
      return `<g opacity="${j.opacity ?? 1}"><path d="M50.4 38.2 C46.5 38.8 45 41.5 44.6 45 C44 50 43 56 42.8 61.5 L47.6 62.2
          C48 57 48.6 51 49.6 46.5 C50.2 44 51 41.5 51.8 39.6 Z" fill="url(#lucy-jacket)"/>
        <rect x="42.5" y="60.6" width="5.6" height="2.1" rx=".9" fill="${j.trim}"/></g>${hand}`;
    case "cropped":
    case "leather": {
      const band =
        j.style === "cropped"
          ? `<path d="M50.5 38.3 C47 38.7 45.2 40.5 44.7 43 L49.9 43.9 L51.8 40.3 Z" fill="${j.trim}"/>
             <rect x="46" y="40.4" width="1.3" height="1.3" fill="${o.top.accent}"/>`
          : `<path d="M48.8 44 L46.2 60" stroke="${j.trim}" stroke-width=".45"/>`;
      return `<path d="M50 38.5 C46.5 39 45 41.5 44.6 45 C44 50 43 56 42.8 61.5 L47.6 62.2 C48 57 48.6 51 49.6 46.5
          C50.2 44 51 41.5 51.6 40 Z" fill="url(#lucy-jacket)" stroke="#00000022" stroke-width=".4"/>
        <path d="M46.2 50 C45.9 53 45.6 56 45.5 59" stroke="#00000018" stroke-width=".5" fill="none"/>
        ${band}
        <rect x="42.5" y="60.6" width="5.6" height="2.3" rx=".9" fill="${j.style === "cropped" ? "#ebe9f4" : j.lining}"/>${hand}`;
    }
  }
}

const FACE = `
  <path d="M52.3 18.5 C52.3 25.5 55.6 30.6 60 31 C64.4 30.6 67.7 25.5 67.7 18.5 C67.7 12.8 64.3 9.8 60 9.8
    C55.7 9.8 52.3 12.8 52.3 18.5 Z" fill="url(#lucy-skin)"/>
  <ellipse cx="60" cy="17.6" rx="7" ry="1.6" fill="#e8b5a6" opacity=".35"/>
  <ellipse cx="54.8" cy="25.2" rx="1.6" ry=".7" fill="#ff8fab" opacity=".45"/>
  <ellipse cx="65.2" cy="25.2" rx="1.6" ry=".7" fill="#ff8fab" opacity=".45"/>
  <path d="M60.2 23.4 L59.8 24.8" stroke="#e7a998" stroke-width=".45" stroke-linecap="round"/>`;

const EYE_LEFT = `
  <g class="eye-open">
    <ellipse cx="56.3" cy="21.5" rx="1.85" ry="2.35" fill="url(#lucy-iris)"/>
    <ellipse cx="56.3" cy="21.9" rx=".85" ry="1.2" fill="#1f1840"/>
    <circle cx="55.7" cy="20.6" r=".6" fill="#fff"/>
    <circle cx="56.9" cy="22.8" r=".3" fill="#fff" opacity=".85"/>
    <path d="M58.6 19.7 Q56.2 18.2 54 19.5 L53 18.8" fill="none" stroke="#231a36" stroke-width=".85" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M53 18.8 L52.3 18.4 M54.1 21.6 Q54.4 23.3 55.6 24" fill="none" stroke="#ff3d6e" stroke-width=".55" stroke-linecap="round"/>
  </g>
  <path class="eye-closed" d="M54.2 21.6 Q56.3 23.2 58.4 21.6" fill="none" stroke="#231a36" stroke-width=".8" stroke-linecap="round"/>
  <path class="eye-happy" d="M54.3 22.6 Q56.3 20.1 58.3 22.6" fill="none" stroke="#231a36" stroke-width=".85" stroke-linecap="round"/>
  <path class="eye-sad" d="M58.3 20.8 Q56.5 21.2 54.3 22.6" fill="none" stroke="#231a36" stroke-width=".85" stroke-linecap="round"/>`;

const MOUTH = `
  <path class="mouth-smile" d="M58.8 27 Q60 27.9 61.2 27" fill="none" stroke="#c9557a" stroke-width=".65" stroke-linecap="round"/>
  <g class="mouth-open"><ellipse cx="60" cy="27.4" rx="1.1" ry=".95" fill="#a53f60"/><ellipse cx="60" cy="27.9" rx=".6" ry=".35" fill="#ff8fa8"/></g>
  <path class="mouth-frown" d="M58.9 27.7 Q60 27 61.1 27.7" fill="none" stroke="#c9557a" stroke-width=".65" stroke-linecap="round"/>`;

function hairFront(o: Outfit): string {
  let extras = "";
  if (o.extras.includes("headphones")) {
    extras += `<path d="M48.9 20 C48.4 9 53.6 3.4 60 3.4 C66.4 3.4 71.6 9 71.1 20" stroke="${INK}" stroke-width="1.3" fill="none"/>
      <rect x="46.6" y="17" width="3.6" height="6.4" rx="1.6" fill="${INK}"/><rect x="69.8" y="17" width="3.6" height="6.4" rx="1.6" fill="${INK}"/>
      <path d="M47.6 18.4 L47.6 22 M72.4 18.4 L72.4 22" stroke="${o.top.accent}" stroke-width=".7" stroke-linecap="round"/>`;
  }
  if (o.extras.includes("moonclip")) {
    extras += `<path d="M68.2 8.2 A3 3 0 1 0 70.4 12.8 A2.3 2.3 0 1 1 68.2 8.2 Z" fill="#ffe68a" stroke="#e9c75a" stroke-width=".3"/>`;
  }
  if (o.extras.includes("glasses")) {
    extras += `<g fill="#ffffff" fill-opacity=".12" stroke="${INK}" stroke-width=".5">
        <circle cx="56.3" cy="21.7" r="2.9"/><circle cx="63.7" cy="21.7" r="2.9"/></g>
      <path d="M59.2 21.2 Q60 20.6 60.8 21.2 M53.4 21.2 L51.6 20.6 M66.6 21.2 L68.4 20.6" stroke="${INK}" stroke-width=".45" fill="none"/>`;
  }
  if (o.extras.includes("sunglasses")) {
    extras += `<path d="M52.6 8.6 L58.6 8.2 L58.4 10.6 C57.8 11.8 54 11.8 53.2 10.6 Z M61.4 8.2 L67.4 8.6 L66.8 10.6 C66 11.8 62.2 11.8 61.6 10.6 Z"
        fill="#1d2440"/><path d="M58.6 8.6 L61.4 8.6" stroke="#1d2440" stroke-width=".7"/>
      <path d="M53.8 9.2 L55.6 9.1 M62.4 9.1 L64.2 9.2" stroke="#8fe9ff" stroke-width=".4" stroke-linecap="round"/>`;
  }
  return `
  <path d="M48.2 21 C47.6 10 53.4 4.4 60 4.4 C66.6 4.4 72.4 10 71.8 21 L71.4 29 C71.2 31.4 68.9 31.9 68 30.1
    L67.1 17.3 L65.3 16.9 L64.5 17.9 L63.6 16.9 L55.8 16.9 L55.1 17.7 L54.3 16.9 L52.9 17.3 L52 30.1
    C51.1 31.9 48.8 31.4 48.6 29 Z" fill="url(#lucy-hair)"/>
  <path d="M55 6.4 Q53.2 11 53.5 16.5 M64.8 6.2 Q66.8 11 66.5 16.6 M58.2 5.2 Q57.6 11 57.8 16.6 M61.8 5.2 Q62.4 11 62.2 16.6
    M50.2 18 Q49.9 24 50.2 29.6 M69.8 18 Q70.1 24 69.8 29.6" stroke="#000" stroke-width=".3" fill="none" opacity=".12"/>
  <path d="M52.8 10.3 Q56.2 6.9 61.8 7.2" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" fill="none" opacity=".65"/>
  ${extras}`;
}

export interface PetParts {
  jacketBack: string;
  hairBack: string;
  legL: string;
  legR: string;
  body: string;
  armL: string;
  armR: string;
  face: string;
  eyeL: string;
  eyeR: string;
  mouth: string;
  hairFront: string;
}

export function renderParts(o: Outfit): PetParts {
  const leg = legLeft(o);
  const arm = armLeft(o);
  return {
    jacketBack: svg(jacketBack(o)),
    hairBack: svg(HAIR_BACK),
    legL: svg(leg),
    legR: svg(mirror(leg)),
    body: svg(body(o)),
    armL: svg(arm),
    armR: svg(mirror(arm)),
    face: svg(FACE),
    eyeL: svg(EYE_LEFT),
    eyeR: svg(mirror(EYE_LEFT)),
    mouth: svg(MOUTH),
    hairFront: svg(hairFront(o)),
  };
}
