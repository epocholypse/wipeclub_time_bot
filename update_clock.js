function two(n) { return String(n).padStart(2, "0"); }
function formatTime(tz) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const hh = parts.find(p => p.type === "hour")?.value ?? "00";
  const mm = parts.find(p => p.type === "minute")?.value ?? "00";
  return `${two(hh)}:${two(mm)}`;
}
function formatDate(tz) {
  const d = new Date();
  return new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "2-digit", month: "short" }).format(d);
}
function buildMessage() {
  const rows = [
    ["Sydney", "Australia/Sydney"],
    ["Baltimore", "America/New_York"],
    ["Toronto", "America/Toronto"],
    ["Helsinki", "Europe/Helsinki"],
    ["Los Angeles", "America/Los_Angeles"]
  ];
  const nowUtc = new Date().toISOString().slice(0, 16).replace("T", " ");
  const lines = [];
  lines.push("WORLD TIME");
  lines.push(`Updated (UTC): ${nowUtc}`);
  lines.push("");
  for (const [label, tz] of rows) {
    lines.push(`${label}: ${formatTime(tz)} (${formatDate(tz)})`);
  }
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
