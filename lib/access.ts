import { isIP } from "node:net";
export function requestDevice(req: Request) {
  const ua = (req.headers.get("user-agent") || "").slice(0, 600);
  const os = /iPad/i.test(ua)
    ? "iPadOS"
    : /iPhone/i.test(ua)
      ? "iOS"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Sistema não identificado";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox|FxiOS/i.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/i.test(ua)
          ? "Chrome"
          : /Safari/i.test(ua)
            ? "Safari"
            : "Navegador não identificado";
  const device = /iPad|Tablet/i.test(ua)
    ? "Tablet"
    : /iPhone|Android.*Mobile/i.test(ua)
      ? "Celular"
      : /Windows|Macintosh|Linux/i.test(ua)
        ? "Computador"
        : "Dispositivo";
  const trusted = process.env.VERCEL === "1" && !process.env.WZY_TEST_SCHEMA;
  const clean = (value: string | null, length = 120) => {
    try {
      return decodeURIComponent(value || "")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, length);
    } catch {
      return "";
    }
  };
  const rawIP = trusted
    ? (
        req.headers.get("x-vercel-forwarded-for") ||
        req.headers.get("x-forwarded-for") ||
        ""
      )
        .split(",")[0]
        .trim()
    : "";
  return {
    device,
    browser,
    os,
    ip: isIP(rawIP) ? rawIP : "",
    city: trusted ? clean(req.headers.get("x-vercel-ip-city")) : "",
    region: trusted
      ? clean(req.headers.get("x-vercel-ip-country-region"), 20)
      : "",
    country: trusted ? clean(req.headers.get("x-vercel-ip-country"), 2) : "",
  };
}
export function isAdministrator(user: { id: string; disabled?: number }) {
  return (
    !user.disabled &&
    (process.env.WZY_ADMIN_USER_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .includes(user.id)
  );
}
