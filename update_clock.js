// update_clock.js
// Posts a new Discord message via webhook if DISCORD_MESSAGE_ID is not set
// Otherwise edits the existing message to update times and daylight state icons
// Uses a sunrise and sunset approximation (NOAA style) per city using fixed lat and lon
function pad2(n) { return String(n).padStart(2, "0"); }
function fmtUtcStampSeconds() {
  const iso = new Date().toISOString().replace("T", " ").slice(0, 19);
  return iso;
}
function getParts(tz) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return {
    hh: Number(get("hour") ?? "0"),
    mm: Number(get("minute") ?? "0"),
    ss: Number(get("second") ?? "0"),
    wd: String(get("weekday") ?? ""),
    dd: String(get("day") ?? ""),
    mon: String(get("month") ?? "")
  };
}
function formatClock(tz) {
  const p = getParts(tz);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}
function formatDayLabel(tz) {
  const p = getParts(tz);
  return `${p.wd} ${p.dd} ${p.mon}`;
}
function minutesSinceMidnight(tz) {
  const p = getParts(tz);
  return (p.hh * 60) + p.mm + (p.ss / 60);
}
function tzOffsetMinutesForNow(tz) {
  const now = new Date();
  const utcParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const tzParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const toNum = (arr, type) => Number(arr.find(p => p.type === type)?.value ?? "0");
  const utcMs = Date.UTC(
    toNum(utcParts, "year"),
    toNum(utcParts, "month") - 1,
    toNum(utcParts, "day"),
    toNum(utcParts, "hour"),
    toNum(utcParts, "minute"),
    toNum(utcParts, "second")
  );
  const tzMs = Date.UTC(
    toNum(tzParts, "year"),
    toNum(tzParts, "month") - 1,
    toNum(tzParts, "day"),
    toNum(tzParts, "hour"),
    toNum(tzParts, "minute"),
    toNum(tzParts, "second")
  );
  return Math.round((tzMs - utcMs) / 60000);
}
function dayOfYearInTz(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false
  }).formatToParts(now);
  const y = Number(parts.find(p => p.type === "year")?.value ?? "1970");
  const m = Number(parts.find(p => p.type === "month")?.value ?? "1");
  const d = Number(parts.find(p => p.type === "day")?.value ?? "1");
  const start = Date.UTC(y, 0, 1);
  const current = Date.UTC(y, m - 1, d);
  return Math.floor((current - start) / 86400000) + 1;
}
function deg2rad(d) { return d * (Math.PI / 180); }
function rad2deg(r) { return r * (180 / Math.PI); }
function normalizeDegrees(d) {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}
function normalizeHours(h) {
  let x = h % 24;
  if (x < 0) x += 24;
  return x;
}
// Sunrise and sunset approximation for the current local date in the given timezone
// Returns minutes since midnight local time
function approxSunriseSunsetMinutes(tz, lat, lon) {
  const N = dayOfYearInTz(tz);
  const tzOffsetMin = tzOffsetMinutesForNow(tz);
  const lngHour = lon / 15;
  const zenith = 90.833;
  function compute(isSunrise) {
    const t = N + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(deg2rad(M))) + (0.020 * Math.sin(deg2rad(2 * M))) + 282.634;
    L = normalizeDegrees(L);
    let RA = rad2deg(Math.atan(0.91764 * Math.tan(deg2rad(L))));
    RA = normalizeDegrees(RA);
    const Lquadrant = Math.floor(L / 90) * 90;
    const RAquadrant = Math.floor(RA / 90) * 90;
    RA = RA + (Lquadrant - RAquadrant);
    RA = RA / 15;
    const sinDec = 0.39782 * Math.sin(deg2rad(L));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(deg2rad(zenith)) - (sinDec * Math.sin(deg2rad(lat)))) / (cosDec * Math.cos(deg2rad(lat)));
    if (cosH > 1) return null;
    if (cosH < -1) return null;
    let H = isSunrise ? (360 - rad2deg(Math.acos(cosH))) : rad2deg(Math.acos(cosH));
    H = H / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    const UT = normalizeHours(T - lngHour);
    const localHours = normalizeHours(UT + (tzOffsetMin / 60));
    return Math.round(localHours * 60);
  }
  const sunrise = compute(true);
  const sunset = compute(false);
  return { sunrise, sunset };
}
function stateEmojiFromSun(tz, lat, lon) {
  const nowMin = minutesSinceMidnight(tz);
  const sun = approxSunriseSunsetMinutes(tz, lat, lon);
  if (sun.sunrise === null || sun.sunset === null) {
    const p = getParts(tz);
    return (p.hh >= 6 && p.hh < 18) ? "☀️" : "🌙";
  }
  const sunrise = sun.sunrise;
  const sunset = sun.sunset;
  const dawnBand = 30;
  const duskBand = 30;
  if (nowMin >= (sunrise - dawnBand) && nowMin < sunrise) return "🌅";
  if (nowMin >= sunrise && nowMin < (sunrise + 120)) return "☀️";
  if (nowMin >= (sunrise + 120) && nowMin < (sunset - 120)) return "☀️";
  if (nowMin >= (sunset - 120) && nowMin < sunset) return "☀️";
  if (nowMin >= sunset && nowMin < (sunset + duskBand)) return "🌆";
  return "🌙";
}
function buildMessage() {
  const cities = [
    { name: "Sydney", tz: "Australia/Sydney", lat: -33.8688, lon: 151.2093 },
    { name: "Baltimore", tz: "America/New_York", lat: 39.2904, lon: -76.6122 },
    { name: "Toronto", tz: "America/Toronto", lat: 43.6532, lon: -79.3832 },
    { name: "Helsinki", tz: "Europe/Helsinki", lat: 60.1699, lon: 24.9384 },
    { name: "Los Angeles", tz: "America/Los_Angeles", lat: 34.0522, lon: -118.2437 }
  ];
  const rows = cities.map(c => {
    const icon = stateEmojiFromSun(c.tz, c.lat, c.lon);
    const time = formatClock(c.tz);
    const day = formatDayLabel(c.tz);
    return { icon, name: c.name, time, day };
  });
  const nameWidth = Math.max(...rows.map(r => r.name.length));
  const lines = [];
  lines.push("WORLD TIME");
  lines.push(`Updated (UTC): ${fmtUtcStampSeconds()}`);
  lines.push("```text");
  for (const r of rows) {
    const namePadded = r.name.padEnd(nameWidth, " ");
    lines.push(`${r.icon}  ${namePadded}  ${r.time}  ${r.day}`);
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
    const url = `${webhookUrl}?wait=true`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error(`Webhook POST failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    console.log(`Created message. Set DISCORD_MESSAGE_ID to: ${data.id}`);
    return;
  }
  const editUrl = `${webhookUrl}/messages/${messageId}`;
  const res = await fetch(editUrl, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error(`Webhook PATCH failed: ${res.status} ${await res.text()}`);
  console.log("Updated message.");
}
main().catch(err => { console.error(err); process.exit(1); });
