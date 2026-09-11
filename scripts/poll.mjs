const secret = process.env.CRON_SECRET ?? "cloth-local-cron-secret";
const url = process.env.AUTH_URL ?? "http://localhost:3000";

const res = await fetch(`${url}/api/cron/poll?secret=${encodeURIComponent(secret)}`);
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
