// The server POSTs to the endpoint, so only real browser push services are
// accepted (Chrome/Edge/Android, Firefox, Safari/iOS, Windows).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
export function isPushEndpoint(raw: string) {
  try {
    const u = new URL(raw);
    if (process.env.PUSH_ALLOW_LOCAL_ENDPOINTS === "1" && u.protocol === "https:" && u.hostname === "127.0.0.1") return true; // tests only
    return u.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}
