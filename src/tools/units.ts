import { formatNumber, normalizeInput, type LocalTool, type ToolReply } from "./types";

/** Offline unit conversion: "10 km to miles", "72 f in c", "2 cups to ml", "1.5 gb in mb". */

type Category = "length" | "mass" | "volume" | "time" | "speed" | "data" | "area" | "energy" | "temperature";

interface Unit {
  category: Category;
  /** Display name (plural-agnostic). */
  label: string;
  /** Size in the category's base unit (temperature uses toBase/fromBase). */
  factor: number;
}

const U = (category: Category, label: string, factor: number, ...aliases: string[]) => ({ category, label, factor, aliases });

const DEFS = [
  // length (metre)
  U("length", "mm", 0.001, "millimeter", "millimeters", "millimetre", "millimetres"),
  U("length", "cm", 0.01, "centimeter", "centimeters", "centimetre", "centimetres"),
  U("length", "m", 1, "meter", "meters", "metre", "metres"),
  U("length", "km", 1000, "kilometer", "kilometers", "kilometre", "kilometres", "kms"),
  U("length", "in", 0.0254, "inch", "inches", '"'),
  U("length", "ft", 0.3048, "foot", "feet", "'"),
  U("length", "yd", 0.9144, "yard", "yards", "yds"),
  U("length", "mi", 1609.344, "mile", "miles"),
  U("length", "nmi", 1852, "nautical mile", "nautical miles"),
  // mass (kilogram)
  U("mass", "mg", 1e-6, "milligram", "milligrams"),
  U("mass", "g", 0.001, "gram", "grams", "gm", "gms"),
  U("mass", "kg", 1, "kilogram", "kilograms", "kilo", "kilos", "kgs"),
  U("mass", "t", 1000, "tonne", "tonnes", "metric ton", "metric tons"),
  U("mass", "oz", 0.028349523125, "ounce", "ounces"),
  U("mass", "lb", 0.45359237, "lbs", "pound", "pounds"),
  U("mass", "st", 6.35029318, "stone", "stones"),
  // volume (litre)
  U("volume", "ml", 0.001, "milliliter", "milliliters", "millilitre", "millilitres"),
  U("volume", "cl", 0.01, "centiliter", "centiliters", "centilitre", "centilitres"),
  U("volume", "l", 1, "liter", "liters", "litre", "litres", "ltr"),
  U("volume", "tsp", 0.00492892159375, "teaspoon", "teaspoons"),
  U("volume", "tbsp", 0.01478676478125, "tablespoon", "tablespoons"),
  U("volume", "fl oz", 0.0295735295625, "floz", "fluid ounce", "fluid ounces"),
  U("volume", "cup", 0.2365882365, "cups"),
  U("volume", "pt", 0.473176473, "pint", "pints"),
  U("volume", "qt", 0.946352946, "quart", "quarts"),
  U("volume", "gal", 3.785411784, "gallon", "gallons"),
  U("volume", "m³", 1000, "m3", "cubic meter", "cubic meters", "cubic metre", "cubic metres"),
  // time (second)
  U("time", "ms", 0.001, "millisecond", "milliseconds"),
  U("time", "s", 1, "sec", "secs", "second", "seconds"),
  U("time", "min", 60, "mins", "minute", "minutes"),
  U("time", "h", 3600, "hr", "hrs", "hour", "hours"),
  U("time", "days", 86400, "day", "d"),
  U("time", "weeks", 604800, "week", "wk", "wks"),
  U("time", "months", 2629746, "month"),
  U("time", "years", 31556952, "year", "yr", "yrs"),
  // speed (metre per second)
  U("speed", "m/s", 1, "mps", "meters per second", "metres per second"),
  U("speed", "km/h", 1 / 3.6, "kmh", "kph", "kmph", "kilometers per hour", "kilometres per hour"),
  U("speed", "mph", 0.44704, "miles per hour"),
  U("speed", "knots", 0.514444, "knot", "kn", "kt"),
  U("speed", "ft/s", 0.3048, "fps", "feet per second"),
  // data (byte)
  U("data", "bits", 0.125, "bit"),
  U("data", "B", 1, "byte", "bytes"),
  U("data", "KB", 1e3, "kb", "kilobyte", "kilobytes"),
  U("data", "MB", 1e6, "mb", "megabyte", "megabytes"),
  U("data", "GB", 1e9, "gb", "gigabyte", "gigabytes", "gig", "gigs"),
  U("data", "TB", 1e12, "tb", "terabyte", "terabytes"),
  U("data", "KiB", 1024, "kib"),
  U("data", "MiB", 1024 ** 2, "mib"),
  U("data", "GiB", 1024 ** 3, "gib"),
  U("data", "TiB", 1024 ** 4, "tib"),
  // area (square metre)
  U("area", "cm²", 1e-4, "cm2", "sq cm", "square centimeter", "square centimeters"),
  U("area", "m²", 1, "m2", "sq m", "sqm", "square meter", "square meters", "square metre", "square metres"),
  U("area", "km²", 1e6, "km2", "sq km", "square kilometer", "square kilometers"),
  U("area", "ha", 1e4, "hectare", "hectares"),
  U("area", "acres", 4046.8564224, "acre"),
  U("area", "ft²", 0.09290304, "ft2", "sq ft", "sqft", "square foot", "square feet"),
  U("area", "in²", 0.00064516, "in2", "sq in", "square inch", "square inches"),
  U("area", "mi²", 2589988.110336, "mi2", "sq mi", "square mile", "square miles"),
  // energy (joule)
  U("energy", "J", 1, "j", "joule", "joules"),
  U("energy", "kJ", 1000, "kj", "kilojoule", "kilojoules"),
  U("energy", "cal", 4.184, "calorie", "calories"),
  U("energy", "kcal", 4184, "kilocalorie", "kilocalories", "cals"),
  U("energy", "Wh", 3600, "wh", "watt hour", "watt hours"),
  U("energy", "kWh", 3.6e6, "kwh", "kilowatt hour", "kilowatt hours"),
  // temperature (handled specially)
  U("temperature", "°C", 0, "c", "°c", "celsius", "centigrade", "degc", "degrees c", "degrees celsius"),
  U("temperature", "°F", 0, "f", "°f", "fahrenheit", "degf", "degrees f", "degrees fahrenheit"),
  U("temperature", "K", 0, "k", "kelvin", "kelvins"),
];

const UNITS = new Map<string, Unit>();
for (const d of DEFS) {
  const unit: Unit = { category: d.category, label: d.label, factor: d.factor };
  for (const name of [d.label, ...d.aliases]) {
    const key = name.toLowerCase();
    // Case matters only for data units ("mb" and "MB" both mean megabytes here), so first wins.
    if (!UNITS.has(key)) UNITS.set(key, unit);
  }
}

export function findUnit(raw: string): Unit | undefined {
  const key = raw
    .toLowerCase()
    .replace(/^(?:an?|the)\s+/, "")
    .replace(/^degrees?\s+(?=[cfk]$|celsius|fahrenheit|kelvin)/, "")
    .replace(/\s+/g, " ")
    .trim();
  return UNITS.get(key);
}

function toKelvin(value: number, unit: string): number {
  if (unit === "°C") return value + 273.15;
  if (unit === "°F") return ((value - 32) * 5) / 9 + 273.15;
  return value;
}

function fromKelvin(kelvin: number, unit: string): number {
  if (unit === "°C") return kelvin - 273.15;
  if (unit === "°F") return ((kelvin - 273.15) * 9) / 5 + 32;
  return kelvin;
}

export function convert(value: number, from: Unit, to: Unit): number {
  if (from.category !== to.category) throw new Error("incompatible units");
  if (from.category === "temperature") return fromKelvin(toKelvin(value, from.label), to.label);
  return (value * from.factor) / to.factor;
}

const PATTERN =
  /^(?:convert\s+|how (?:much|many) is\s+|what(?:'s| is)\s+)?(-?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*([^\d\s][^]*?)\s+(?:to|in|into|as|->|→|=)\s+(?:an?\s+)?([^]+?)$/i;

export interface Conversion {
  value: number;
  from: Unit;
  to: Unit;
  result: number;
}

/** Parse and convert, or null when `input` isn't a conversion. `error` when the units don't match. */
export function parseConversion(input: string): Conversion | { error: string } | null {
  const m = PATTERN.exec(normalizeInput(input));
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,/g, ""));
  const from = findUnit(m[2]);
  const to = findUnit(m[3]);
  if (!from || !to || !Number.isFinite(value)) return null;
  if (from.category !== to.category) {
    return { error: `${from.label} and ${to.label} measure different things (${from.category} vs ${to.category}).` };
  }
  return { value, from, to, result: convert(value, from, to) };
}

export const UnitsTool = {
  id: "units",
  name: "Convert",
  icon: "📏",
  description: "Units offline: 10 km to miles, 72 f in c, 2 cups to ml, 1.5 gb in mb.",
  handle(input: string): ToolReply | null {
    const c = parseConversion(input);
    if (!c) return null;
    if ("error" in c) return { title: "Convert", text: `Can't convert that: ${c.error}` };
    const a = `${formatNumber(c.value)} ${c.from.label}`;
    const b = `${formatNumber(c.result)} ${c.to.label}`;
    return { title: "Convert", text: `${a} = **${b}**`, speech: `${formatNumber(c.result)} ${spoken(c.to.label)}.` };
  },
} satisfies LocalTool;

const SPOKEN: Record<string, string> = {
  "°C": "degrees Celsius",
  "°F": "degrees Fahrenheit",
  K: "kelvin",
  mm: "millimetres",
  cm: "centimetres",
  m: "metres",
  km: "kilometres",
  in: "inches",
  ft: "feet",
  yd: "yards",
  mi: "miles",
  g: "grams",
  kg: "kilograms",
  lb: "pounds",
  oz: "ounces",
  ml: "millilitres",
  l: "litres",
  "km/h": "kilometres per hour",
  "m/s": "metres per second",
};

function spoken(label: string): string {
  return SPOKEN[label] ?? label;
}
