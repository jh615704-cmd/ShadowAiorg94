export type DeviceType = "laptop_desktop" | "tablet" | "phone" | "other";
type FormFactor = "desktop" | "tablet" | "phone" | "other";

const browserPatterns: Array<[RegExp, string]> = [
  [/(?:Edg|EdgA|EdgiOS)\/([\d.]+)/i, "Edge"],
  [/Firefox\/([\d.]+)/i, "Firefox"],
  [/(?:Chrome|CriOS)\/([\d.]+)/i, "Chrome"],
  [/Version\/([\d.]+).*Safari/i, "Safari"],
];

export function summarizeUserAgent(userAgent: string | null) {
  const ua = userAgent ?? "";
  const browserMatch = browserPatterns
    .map(([pattern, name]) => ({ name, version: ua.match(pattern)?.[1] }))
    .find((match) => match.version);
  const browser = browserMatch
    ? `${browserMatch.name} ${browserMatch.version?.split(".")[0]}`
    : "Unknown browser";

  const windowsVersion = ua.match(/Windows NT ([\d.]+)/i)?.[1];
  const iosVersion = ua.match(/OS ([\d_]+)/i)?.[1]?.replaceAll("_", ".");
  const androidVersion = ua.match(/Android ([\d.]+)/i)?.[1];
  let operating_system = "Unknown operating system";
  if (windowsVersion === "10.0") operating_system = "Windows 10/11";
  else if (windowsVersion === "6.3") operating_system = "Windows 8.1";
  else if (windowsVersion === "6.1") operating_system = "Windows 7";
  else if (/Windows/i.test(ua)) operating_system = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) operating_system = iosVersion ? `iOS ${iosVersion}` : "iOS";
  else if (/Android/i.test(ua)) operating_system = androidVersion ? `Android ${androidVersion}` : "Android";
  else if (/Macintosh|Mac OS/i.test(ua)) operating_system = "macOS";
  else if (/CrOS/i.test(ua)) operating_system = "ChromeOS";
  else if (/Linux/i.test(ua)) operating_system = "Linux";

  const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const phone = /iPhone|iPod|Android.*Mobile|Mobile/i.test(ua);
  const form_factor: FormFactor = tablet
    ? "tablet"
    : phone
      ? "phone"
      : /Windows|Macintosh|Mac OS|Linux|CrOS/i.test(ua)
        ? "desktop"
        : "other";
  const device_type: DeviceType = tablet
    ? "tablet"
    : phone
      ? "phone"
      : form_factor === "desktop"
        ? "laptop_desktop"
        : "other";

  return {
    label: `${browser} · ${operating_system}`,
    browser,
    operating_system,
    device_type,
    form_factor,
  };
}
