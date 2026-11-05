export interface FontChoice {
  id: string;
  label: string;
  family: string;
}

export const FONT_CHOICES: FontChoice[] = [
  { id: "Vazirmatn", label: "وزیرمتن", family: "Vazirmatn" },
  { id: "Vazir", label: "وزیر", family: "Vazir" },
  { id: "Shabnam", label: "شبنم", family: "Shabnam" },
  { id: "Sahel", label: "ساحل", family: "Sahel" },
  { id: "Estedad", label: "استعداد", family: "Estedad" },
  { id: "Tahoma", label: "تاهوما", family: "Tahoma" },
  { id: "Custom", label: "فونت دلخواه", family: "" },
];

export interface BundledFont {
  family: string;
  file: string;
  weight: string;
}

export const BUNDLED_FONTS: BundledFont[] = [
  { family: "Vazirmatn", file: "Vazirmatn-wght.woff2", weight: "100 900" },
  { family: "Vazir", file: "Vazir-Regular.woff2", weight: "400" },
  { family: "Vazir", file: "Vazir-Bold.woff2", weight: "700" },
  { family: "Shabnam", file: "Shabnam.woff2", weight: "400" },
  { family: "Shabnam", file: "Shabnam-Bold.woff2", weight: "700" },
  { family: "Sahel", file: "Sahel.woff2", weight: "400" },
  { family: "Sahel", file: "Sahel-Bold.woff2", weight: "700" },
  { family: "Estedad", file: "Estedad-wght.woff2", weight: "100 900" },
];

export function resolveFontFamily(choice: string | undefined, custom: string | undefined): string {
  if (choice === "Custom") {
    const name = (custom ?? "").trim();
    return name || "Tahoma";
  }
  const found = FONT_CHOICES.find((item) => item.id === choice);
  return found?.family || "Vazirmatn";
}

export function fontStatusLabel(choice: string | undefined, resolvedFamily: string): string {
  if (choice === "Custom") {
    return resolvedFamily;
  }
  return FONT_CHOICES.find((item) => item.id === choice)?.label ?? resolvedFamily;
}

export function cssFontStack(family: string): string {
  const cleaned = family.replace(/["\\<>]/g, "").trim() || "Vazirmatn";
  if (cleaned.toLowerCase() === "tahoma") {
    return "Tahoma, sans-serif";
  }
  return `"${cleaned}", Tahoma, sans-serif`;
}
