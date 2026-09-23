const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wa = require('@simplewebauthn/server');
const REQUIRE_PASSKEY = false;
const ENROLL_TTL_MS = 20 * 60 * 1000, CHALLENGE_TTL_MS = 2 * 60 * 1000, SESSION_TTL_S = 30 * 86400, COOKIE = 'amni_sess';
const b64u = (b) => Buffer.from(b).toString('base64url');
function createAuth(dataRoot) {
  const tunnelPath = path.join(dataRoot, 'tunnel.json'), devPath = path.join(dataRoot, 'passkeys.json'), secretPath = path.join(dataRoot, 'auth-secret');
  const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
  const tunnel = () => readJson(tunnelPath, {});
  const hostname = () => String(tunnel().hostname || '').toLowerCase();
  const origin = () => 'https://' + hostname();
  const devices = () => readJson(devPath, { devices: [] }).devices || [];
  const saveDevices = (list) => fs.writeFileSync(devPath, JSON.stringify({ devices: list }, null, 1));
  const secret = (() => { try { return fs.readFileSync(secretPath, 'utf8').trim(); } catch (_) { const s = crypto.randomBytes(32).toString('hex'); fs.mkdirSync(dataRoot, { recursive: true }); fs.writeFileSync(secretPath, s); return s; } })();
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  const enrollTokens = new Map(), challenges = new Map();
  const sweep = () => { const now = Date.now(); for (const [k, v] of enrollTokens) v.exp < now && enrollTokens.delete(k); for (const [k, v] of challenges) v.exp < now && challenges.delete(k); };
  const hostOf = (h) => String((h && (h['x-forwarded-host'] || h.host)) || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  // Anything Cloudflare forwarded is remote even when tunnel.json is absent (system cloudflared).
  const isRemote = (h) => !!(h && h['cf-connecting-ip']) || (!!hostname() && hostOf(h) === hostname());
  const isLoopback = (req) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket?.remoteAddress || '') && !isRemote(req.headers);
  const cookieOf = (h) => { const m = String((h && h.cookie) || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)')); return m ? m[1] : ''; };
  const session = (h) => {
    const [body, sig] = cookieOf(h).split('.');
    if (!body || !sig || sign(body) !== sig) return null;
    const p = readJsonStr(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.exp > Date.now() / 1000 && devices().some(d => d.id === p.d) ? p : null;
  };
  function readJsonStr(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  const issue = (res, dev, h) => {
    const body = b64u(JSON.stringify({ d: dev.id, n: dev.name, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }));
    res.setHeader('Set-Cookie', `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}${isRemote(h) ? '; Secure' : ''}`);
  };
  const allowed = (h) => !REQUIRE_PASSKEY || !isRemote(h) || !!session(h);
  const status = (h) => ({ enabled: !!hostname(), hostname: hostname(), remote: isRemote(h), authed: !!session(h), required: REQUIRE_PASSKEY, devices: devices().length, device: (session(h) || {}).n || null });
  function routes(app) {
    app.get('/auth/status', (req, res) => res.json(status(req.headers)));
    app.get('/auth/me', (req, res) => res.json(status(req.headers)));
    app.post('/auth/enroll-token', (req, res) => {
      if (!isLoopback(req)) return res.status(403).json({ error: 'host window only' });
      if (!hostname()) return res.status(400).json({ error: 'no tunnel hostname configured' });
      sweep();
      const token = crypto.randomBytes(18).toString('base64url'), exp = Date.now() + ENROLL_TTL_MS;
      enrollTokens.set(token, { exp });
      const ver = (() => { try { return require('./package.json').version; } catch (_) { return '1'; } })();
      res.json({ token, exp, url: `${origin()}/viewer?enroll=${token}&code=${encodeURIComponent(String(req.body?.code || ''))}&v=${ver}` });
    });
    app.get('/auth/devices', (req, res) => isLoopback(req) ? res.json({ devices: devices().map(d => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastUsed: d.lastUsed })) }) : res.status(403).json({ error: 'host window only' }));
    app.delete('/auth/devices/:id', (req, res) => { if (!isLoopback(req)) return res.status(403).json({ error: 'host window only' }); saveDevices(devices().filter(d => d.id !== req.params.id)); res.json({ ok: true }); });
    app.post('/auth/enroll/options', async (req, res) => {
      sweep();
      const t = enrollTokens.get(String(req.body?.token || ''));
      if (!t) return res.status(403).json({ error: 'enrollment link expired or already used' });
      const name = String(req.body?.name || 'device').slice(0, 64);
      const opts = await wa.generateRegistrationOptions({ rpName: 'Amni-Connect', rpID: hostname(), userName: name, userID: crypto.randomBytes(16), attestationType: 'none', excludeCredentials: devices().map(d => ({ id: d.credentialID, transports: d.transports })), authenticatorSelection: { residentKey: 'discouraged', requireResidentKey: false, userVerification: 'discouraged' } });
      t.challenge = opts.challenge; t.name = name; t.cexp = Date.now() + CHALLENGE_TTL_MS;
      res.json(opts);
    });
    app.post('/auth/enroll/verify', async (req, res) => {
      const token = String(req.body?.token || ''), t = enrollTokens.get(token);
      if (!t || !t.challenge || t.cexp < Date.now()) return res.status(403).json({ error: 'enrollment link expired or already used' });
      try {
        const v = await wa.verifyRegistrationResponse({ response: req.body.response, expectedChallenge: t.challenge, expectedOrigin: origin(), expectedRPID: hostname(), requireUserVerification: false });
        if (!v.verified) return res.status(400).json({ error: 'passkey not verified' });
        const c = v.registrationInfo.credential;
        const dev = { id: crypto.randomBytes(8).toString('hex'), name: t.name, credentialID: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports || [], createdAt: new Date().toISOString() };
        saveDevices([...devices(), dev]);
        enrollTokens.delete(token);
        issue(res, dev, req.headers);
        res.json({ ok: true, device: dev.name });
      } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    app.post('/auth/login/options', async (req, res) => {
      sweep();
      if (!devices().length) return res.status(403).json({ error: 'no devices enrolled' });
      const opts = await wa.generateAuthenticationOptions({ rpID: hostname(), allowCredentials: devices().map(d => ({ id: d.credentialID, transports: d.transports })), userVerification: 'discouraged' });
      const id = crypto.randomBytes(12).toString('base64url');
      challenges.set(id, { challenge: opts.challenge, exp: Date.now() + CHALLENGE_TTL_MS });
      res.json({ id, options: opts });
    });
    app.post('/auth/login/verify', async (req, res) => {
      const ch = challenges.get(String(req.body?.id || ''));
      challenges.delete(String(req.body?.id || ''));
      if (!ch || ch.exp < Date.now()) return res.status(403).json({ error: 'challenge expired' });
      const list = devices(), dev = list.find(d => d.credentialID === req.body?.response?.id);
      if (!dev) return res.status(403).json({ error: 'unknown passkey' });
      try {
        const v = await wa.verifyAuthenticationResponse({ response: req.body.response, expectedChallenge: ch.challenge, expectedOrigin: origin(), expectedRPID: hostname(), requireUserVerification: false, credential: { id: dev.credentialID, publicKey: Buffer.from(dev.publicKey, 'base64url'), counter: dev.counter, transports: dev.transports } });
        if (!v.verified) return res.status(403).json({ error: 'passkey rejected' });
        dev.counter = v.authenticationInfo.newCounter; dev.lastUsed = new Date().toISOString();
        saveDevices(list);
        issue(res, dev, req.headers);
        res.json({ ok: true, device: dev.name });
      } catch (e) { res.status(403).json({ error: String(e.message || e) }); }
    });
    app.post('/auth/logout', (_, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`); res.json({ ok: true }); });
  }
  return { hostname, origin, isRemote, isLoopback, allowed, session, status, routes, tunnel };
}
module.exports = { createAuth };
