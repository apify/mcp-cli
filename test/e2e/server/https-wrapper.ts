/**
 * HTTPS reverse proxy wrapper for E2E testing of --insecure flag.
 * Wraps the plain HTTP test server with a self-signed TLS certificate.
 *
 * Environment variables:
 *   TARGET_URL - upstream HTTP server URL (required, e.g. "http://localhost:12345")
 *
 * Outputs to stdout once ready:
 *   HTTPS_PORT=<port>
 */

import https from 'node:https';
import http from 'node:http';

const TARGET_URL = process.env.TARGET_URL;
if (!TARGET_URL) {
  console.error('TARGET_URL environment variable is required');
  process.exit(1);
}

const targetUrl = new URL(TARGET_URL);

// Self-signed certificate for localhost (test-only, generated with openssl)
const CERT = `-----BEGIN CERTIFICATE-----
MIIDCzCCAfOgAwIBAgIUBOlWq7B2SExKUgSM2qgn+K+d62owDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDMxMTIyMDMwMVoYDzIxMjYw
MjE1MjIwMzAxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCZ0iTLZMNg3iodFMr1qh+dJKhV1yTkS2IkUOLhD2E+
7D0ooLk8ryfl10J33If4ewJalic1FTHd603tafTCQ4r5zSWBpB5vaBW7RL3y+4Z5
fGliVDStQk7TWN62E6RObTxxNAANcgxFI2wJoY4FDw983x2H5q9RNX9Fb4O1Tltt
kZVnq7PYZvTEavibgnkTFma8f0C2OY8AJNXOuR6wegLBrXPZCLZARyNMh2ey3hIW
sJLf6ZmQGpdFGbebrf27Hu6OwBwyBbd60k7PdgAmvRtc5PYgjHhGi8LLisP+fwZC
t6AmfiR4Tdmys1ps9vMX6Tmh3e3zWki1XK77UoeWp62jAgMBAAGjUzBRMB0GA1Ud
DgQWBBQGQIELFIB0qfxd4AiuCY6EJOMncTAfBgNVHSMEGDAWgBQGQIELFIB0qfxd
4AiuCY6EJOMncTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQB1
3Q+WCB+kzonOPsPnDpgHla1RqfsUPLZqZbUNSMg3QlOyBaJCCi3lAtW+fV3sqeip
Za4lQyjVkwYMe9FgudHl8Ms1dK5GaWSvjTh4MTehjn/CdLopgjWfPnb5VPYdDeQp
7hyIM25PS1IjZEBQ5eNoaV3JLsJaj2rdz/NA9ruWYZcasuCBJt3D0JK8QYkD8kBH
2jZs4n9Zer5KMLfNLwJ+zXPzHRISFpDlzRW72I7kBFTiUbJfZzfWICw4dC10US2j
S6+OSPNWlNHrvzlNE+JftCkJ5a90FXV8SyxIxmfCbSDctbA+UrDlOHheP/Y+BHik
eiTEUfO+DyPteuf53eeH
-----END CERTIFICATE-----`;

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCZ0iTLZMNg3iod
FMr1qh+dJKhV1yTkS2IkUOLhD2E+7D0ooLk8ryfl10J33If4ewJalic1FTHd603t
afTCQ4r5zSWBpB5vaBW7RL3y+4Z5fGliVDStQk7TWN62E6RObTxxNAANcgxFI2wJ
oY4FDw983x2H5q9RNX9Fb4O1TlttkZVnq7PYZvTEavibgnkTFma8f0C2OY8AJNXO
uR6wegLBrXPZCLZARyNMh2ey3hIWsJLf6ZmQGpdFGbebrf27Hu6OwBwyBbd60k7P
dgAmvRtc5PYgjHhGi8LLisP+fwZCt6AmfiR4Tdmys1ps9vMX6Tmh3e3zWki1XK77
UoeWp62jAgMBAAECggEADh/v5QVxs3lzIIyCPqDKmmF9W7SP3K7XakJLMyN4aJDE
5PAtUlc7MK3dmqgTjEuvYaYcH5G8rIYo974dDaGqJ1ohMZBigxRpunKLhr52EL3N
54uX8rj+CAZHHS0cj18Uh8igoJtyaP7hsti08934LB1I1uvl+W0SLMwaqhFx79Ok
CynoeGc+a/2Bx69d+XPILuke23QBAeQq/Duz5m6sG00VCXXOqADaZtXeE/a7UauG
acCpb3Mj9u9g/gIRPRXqoedPLHMCb0syzq9dRhPmxj7dzcyeEZbmr8EBEq0t+lWR
4D4mlABEFwa5yoGcAQ1W+5c/UFKH9n8bD0eGagKPYQKBgQDPqgEJYjzLTunA67Y7
paREhUw8FL42ZT+xihF0H2JGwJYYkehKiFCaa5VjeMeBfXyGWAv8ZINqeG1s7JAc
oczcOi/rrahlMxjvmfdNRL3gyKftV5BERZr2fXk+ZrqiUZ5OSclFCscKxkeHkG5f
q0+AxNeiN6yyKPpc50zOaGLpuQKBgQC9n85qC1GaY+WIzO5JIil+Egy+KWZltie4
dQj9bVXnT2XIwBJgwGgYwk5Jkp64Zd2FX1KhgSeT02wPlLKK82llHnS/oPFnnzMz
DvJ95yMCrS573hENiiFdrPGVFzQR8nq5qlbTmHSDO+88DPfr4Jb/hhCjCqMcgK7T
IBQdVmJQOwKBgE4aqcMmwKjS6FYYEXVDqpHe9LpQLu50jE0xGblsKGFmA83/6rdF
p9M8jXZZMehBEznQGcn23/qGitmB6/3o2Q0nkWh56zEM098iMIJOTYAi2A4LdgZH
i64TqStQJffw7LKTS/D8yboCs1qIdwriesd6wYOQnxJvGSMiF6A2YKV5AoGAPHdS
+Nm3IcYtEVxXt5ZfKMZUrebBsjlNnTIktbtBo0rcKBGnSpbQGuUK1ccdOaux4a+t
x7ZJiofmc2l1LX3E4+u8Ssblc6d+Sg/AH4muzlGu+uyq/2hGj3pwZpxJjFeH7uB0
Y3C/5oEcHkf8Xoj1XXHAqFzh+lrGZKhcAabkHrUCgYA8a0yKGlj2K+E1CwnsJUCQ
D+ysoiJZpdmwH5mqt+oAgKk8PqRE+/rIo5Prh3uHJSgZjnIA4CNAq1xKiLQG8DOI
VUuOQXVNfXMtuw1dPAI24wLmLzI1JTC4hn6ZRZEQ/77OsESAy8MNlAZbMN2E9bnW
hKeM+bz8VOxaqoq6JMoyLw==
-----END PRIVATE KEY-----`;

const server = https.createServer({ cert: CERT, key: KEY }, (req, res) => {
  // Proxy all requests to the target HTTP server
  const proxyReq = http.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (addr && typeof addr === 'object') {
    process.stdout.write(`HTTPS_PORT=${addr.port}\n`);
  }
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
