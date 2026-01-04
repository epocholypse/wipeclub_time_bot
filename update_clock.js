// update_clock.js
// Discord webhook world time board with dynamic sunrise and sunset icons
// Cities are sorted by current local time on each update
// Output includes correct UTC offsets using system timezone data
// Inserts blank lines when the local date changes
// Fix included for locales that return hour "24" at midnight

function pad2(n) {
  return String(n).padStart(2, "0");
}

function utcStampSeconds() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function getParts(tz) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).formatToParts(new Date());

  const get = (t) => parts.find((p) => p.type === t)?.value;

  const rawHour = Number(get("hour") || 0);
  const hh = rawHour === 24 ? 0 : rawHour;

  return {
    hh,
    mm: Number(get("minute") || 0),
    ss: Number(get("second") || 0),
    wd: get("weekday") || "",
    dd: get("day") || "",
    mon: get("month") || ""
  };
}

function minutesSinceMidnight(tz) {
  const p = getParts(tz);
  return p.hh * 60 + p.mm + p.ss / 60;
}

function formatTime(tz) {
  const p = getParts(tz);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}

function formatDay(tz) {
  const p = getParts(tz);
  return `${p.wd} ${p.dd} ${p.mon}`;
}

function dayKey(tz) {
  const p = getParts(tz);
  return `${p.dd} ${p.mon} ${p.wd}`;
}

function dayOfYear(tz) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = Number(parts.find((p) => p.type === "year")?.value || 1970);
  const m = Number(parts.find((p) => p.type === "month")?.value || 1);
  const d = Number(parts.find((p) => p.type === "day")?.value || 1);

  const start = Date.UTC(y, 0, 1);
  const current = Date.UTC(y, m - 1, d);
  return Math.floor((current - start) / 86400000) + 1;
}

function utcOffsetLabel(tz) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset"
  });
  const parts = fmt.formatToParts(now);
  const off = parts.find((p) => p.type === "timeZoneName")?.value || "UTC";
  return off.replace("GMT", "UTC");
}

function tzOffsetMinutesFromLabel(tz) {
  const label = utcOffsetLabel(tz); // e.g. UTC+11, UTC-05, UTC+09:30
  const m = label.match(/UTC([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] || 0);
  const mm = Number(m[3] || 0);
  return sign * (hh * 60 + mm);
}

function deg2rad(d) {
  return (d * Math.PI) / 180;
}

function rad2deg(r) {
  return (r * 180) / Math.PI;
}

function normalize(v, max) {
  let x = v % max;
  if (x < 0) x += max;
  return x;
}

function approxSunTimesLocalMinutes(tz, lat, lon) {
  const N = dayOfYear(tz);
  const offsetHours = tzOffsetMinutesFromLabel(tz) / 60;
  const lngHour = lon / 15;
  const zenith = 90.833;

  function calc(isRise) {
    const t = N + ((isRise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;

    let L = M + 1.916 * Math.sin(deg2rad(M)) + 0.02 * Math.sin(deg2rad(2 * M)) + 282.634;
    L = normalize(L, 360);

    let RA = rad2deg(Math.atan(0.91764 * Math.tan(deg2rad(L))));
    RA = normalize(RA, 360);

    const Lq = Math.floor(L / 90) * 90;
    const RAq = Math.floor(RA / 90) * 90;
    RA = (RA + (Lq - RAq)) / 15;

    const sinDec = 0.39782 * Math.sin(deg2rad(L));
    const cosDec = Math.cos(Math.asin(sinDec));

    const cosH =
      (Math.cos(deg2rad(zenith)) - sinDec * Math.sin(deg2rad(lat))) /
      (cosDec * Math.cos(deg2rad(lat)));

    if (cosH > 1 || cosH < -1) return null;

    let H = isRise ? 360 - rad2deg(Math.acos(cosH)) : rad2deg(Math.acos(cosH));
    H = H / 15;

    const T = H + RA - 0.06571 * t - 6.622;
    const UT = normalize(T - lngHour, 24);
    const localHours = normalize(UT + offsetHours, 24);

    return Math.round(localHours * 60);
  }

  return { sunrise: calc(true), sunset: calc(false) };
}

function sunEmoji(tz, lat, lon) {
  const now = minutesSinceMidnight(tz);
  const sun = approxSunTimesLocalMinutes(tz, lat, lon);

  if (sun.sunrise === null || sun.sunset === null) {
    return now >= 360 && now < 1080 ? "☀️" : "🌙";
  }

  if (now >= sun.sunrise - 30 && now < sun.sunrise) return "🌅";
  if (now >= sun.sunrise && now < sun.sunset) return "☀️";
  if (now >= sun.sunset && now < sun.sunset + 30) return "🌆";
  return "🌙";
}

function buildMessage() {
  const cities = [
    { name: "Auckland", tz: "Pacific/Auckland", lat: -36.8485, lon: 174.7633 },
    { name: "Sydney", tz: "Australia/Sydney", lat: -33.8688, lon: 151.2093 },
    { name: "Singapore", tz: "Asia/Singapore", lat: 1.3521, lon: 103.8198 },
    { name: "Istanbul", tz: "Europe/Istanbul", lat: 41.0082, lon: 28.9784 },
    { name: "Helsinki", tz: "Europe/Helsinki", lat: 60.1699, lon: 24.9384 },
    { name: "London", tz: "Europe/London", lat: 51.5074, lon: -0.1278 },
    { name: "Guadalajara", tz: "America/Mexico_City", lat: 20.6597, lon: -103.3496 },
    { name: "Austin", tz: "America/Chicago", lat: 30.2672, lon: -97.7431 },
    { name: "Baltimore", tz: "America/New_York", lat: 39.2904, lon: -76.6122 },
    { name: "Toronto", tz: "America/Toronto", lat: 43.6532, lon: -79.3832 },
    { name: "Los Angeles", tz: "America/Los_Angeles", lat: 34.0522, lon: -118.2437 }
  ];

  const rows = cities.map((c) => ({
    name: c.name,
    tz: c.tz,
    time: formatTime(c.tz),
    day: formatDay(c.tz),
    dayKey: dayKey(c.tz),
    mins: minutesSinceMidnight(c.tz),
    icon: sunEmoji(c.tz, c.lat, c.lon),
    offset: utcOffsetLabel(c.tz)
  }));

  rows.sort((a, b) => a.mins - b.mins);

  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const offsetWidth = Math.max(...rows.map((r) => r.offset.length));

  const lines = [];
  lines.push("WORLD TIME");
  lines.push(`Updated (UTC): ${utcStampSeconds()}`);
  lines.push("```text");
  lines.push(`ICON  ${"LOCATION".padEnd(nameWidth)}  TIME   ${"OFFSET".padEnd(offsetWidth)}  DATE`);
  lines.push(`====  ${"=".repeat(nameWidth)}  =====  ${"=".repeat(offsetWidth)}  ===========`);

  let lastDayKey = null;
  for (const r of rows) {
    if (lastDayKey && r.dayKey !== lastDayKey) {
      lines.push("");
    }
    lines.push(`${r.icon}    ${r.name.padEnd(nameWidth)}  ${r.time}  ${r.offset.padEnd(offsetWidth)}  ${r.day}`);
    lastDayKey = r.dayKey;
  }

  lines.push("```");
  return lines.join("\n");
}

async function main() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("Missing DISCORD_WEBHOOK_URL");

  const messageId = process.env.DISCORD_MESSAGE_ID;
  const content = buildMessage();

  if (!messageId) {
    const res = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });

    if (!res.ok) throw new Error(`Webhook POST failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    console.log(`Created message. Set DISCORD_MESSAGE_ID to: ${data.id}`);
    return;
  }

  const res = await fetch(`${webhookUrl}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });

  if (!res.ok) throw new Error(`Webhook PATCH failed: ${res.status} ${await res.text()}`);
  console.log("Updated message.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
