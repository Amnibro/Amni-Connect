const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_S = 30 * 86400, PAIR_MS = 10 * 60 * 1000, INVITE_DAYS_MAX = 90, COOKIE = 'ac_sess';
const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const code = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();
function createCloud(dataRoot, secret) {
  const file = path.join(dataRoot, 'cloud.json');
  const db = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; } })();
  for (const k of ['users', 'devices', 'invites', 'pairs']) db[k] = db[k] || {};
  db.grants = db.grants || [];
  const cfgFile = path.join(dataRoot, 'cloud-config.json');
  let cfgCache = null, cfgAt = 0;
  const conf = () => now() - cfgAt < 5000 && cfgCache ? cfgCache : (cfgAt = now(), cfgCache = (() => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (_) { return {}; } })());
  const v4 = (s) => s.split('.').reduce((a, x) => a * 256 + +x, 0);
  const inCidr = (ip, c) => { const [b, m] = String(c).split('/'); return m === undefined ? ip === b : /^\d+\.\d+\.\d+\.\d+$/.test(ip) && Math.floor(v4(ip) / 2 ** (32 - +m)) === Math.floor(v4(b) / 2 ** (32 - +m)); };
  const peerIp = (h, addr) => { const a = String(addr || '').replace(/^::ffff:/, ''), cf = h && h['cf-connecting-ip']; return (a === '127.0.0.1' || a === '::1') && cf ? String(cf).replace(/^::ffff:/, '') : a; };
  const ipOk = (h, addr) => { const allow = conf().allow, p = peerIp(h, addr); return !Array.isArray(allow) || !allow.length || ((p === '127.0.0.1' || p === '::1') && !(h && h['cf-connecting-ip'])) || allow.some((c) => inCidr(p, c)); };
  let timer = null;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, file); }, 80); };
  const online = new Map();
  const fails = new Map();
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  const hashPw = (pw, salt = rid(16)) => salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('base64url');
  const checkPw = (pw, stored) => { const [salt, h] = String(stored || '').split(':'); if (!salt || !h) return false; const a = Buffer.from(hashPw(pw, salt).split(':')[1]), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const cookieOf = (h) => { const m = String((h && h.cookie) || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)')); return m ? m[1] : ''; };
  const userOf = (h) => {
    const [body, sig] = cookieOf(h).split('.');
    if (!body || !sig || sign(body) !== sig) return null;
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
    const u = p && p.exp > now() / 1000 && db.users[p.u];
    return u && (u.v || 0) === (p.v || 0) && (u.via !== 'passcode' || (conf().passcode && u.pc === sha(conf().passcode.hash))) ? { id: p.u, ...u } : null;
  };
  const secure = (req) => !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-proto'] === 'https');
  const issue = (req, res, uid) => { const body = Buffer.from(JSON.stringify({ u: uid, v: db.users[uid].v || 0, exp: Math.floor(now() / 1000) + SESSION_S })).toString('base64url'); res.setHeader('Set-Cookie', `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_S}${secure(req) ? '; Secure' : ''}`); };
  const ip = (req) => peerIp(req.headers, req.socket?.remoteAddress);
  const limited = (key) => { const f = fails.get(key); return f && now() - f.t < 15 * 60 * 1000 && f.n >= 10; };
  const failed = (key) => { const f = fails.get(key) && now() - fails.get(key).t < 15 * 60 * 1000 ? fails.get(key) : { n: 0, t: now() }; f.n++; fails.set(key, f); };
  const role = (uid, did) => { const d = db.devices[did]; if (!d || !uid) return null; if (d.owner === uid) return 'owner'; const pc = db.users[uid]?.via === 'passcode' && conf().passcode; if (pc) return db.users[d.owner]?.login === pc.owner ? pc.role || 'control' : null; const g = db.grants.find((x) => x.device === did && x.user === uid && (!x.exp || x.exp > now())); return g ? g.role : null; };
  const byCode = (uid, raw, from) => {
    const id = String(raw || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, ''), k = 'pc:' + uid, ki = 'pi:' + (from || ''), r = uid && role(uid, id);
    if (r) return { id, role: r };
    if (!uid || limited(k) || (from && limited(ki))) return { error: 'Too many wrong codes, wait 15 minutes' };
    if (!db.devices[id]) { failed(k); from && failed(ki); return { error: 'No computer has that code' }; }
    db.grants.push({ device: id, user: uid, role: 'control', exp: 0, by: 'code', at: now() }); save();
    return { id, role: 'control' };
  };
  const deviceView = (did, uid) => { const d = db.devices[did]; return { id: did, name: d.name, platform: d.platform, online: online.has(did), lastSeen: online.has(did) ? now() : d.lastSeen || null, role: role(uid, did), owner: db.users[d.owner]?.name || '' }; };
  const need = (req, res) => { const u = userOf(req.headers); if (!u) { res.status(401).json({ error: 'sign in' }); return null; } return u; };
  const owned = (req, res) => { const u = need(req, res); if (!u) return null; const d = db.devices[req.params.id]; if (!d || d.owner !== u.id) { res.status(404).json({ error: 'not your device' }); return null; } return { u, d }; };
  const clean = (s, n) => String(s || '').trim().slice(0, n);
  const sweep = () => { const t = now(); for (const [k, p] of Object.entries(db.pairs)) if (p.exp < t) delete db.pairs[k]; for (const [k, v] of Object.entries(db.invites)) if (v.exp < t || (v.max && v.uses >= v.max)) delete db.invites[k]; db.grants = db.grants.filter((g) => !g.exp || g.exp > t); };
  function routes(app) {
    app.post('/api/signup', (req, res) => {
      const login = clean(req.body?.login, 64).toLowerCase(), name = clean(req.body?.name, 48) || login, pw = String(req.body?.password || '');
      if (!/^[a-z0-9._@+-]{3,64}$/.test(login)) return res.status(400).json({ error: 'Use 3-64 letters, numbers or . _ @ + -' });
      if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      if (limited('su:' + ip(req))) return res.status(429).json({ error: 'Too many attempts, try again later' });
      if (Object.values(db.users).some((u) => u.login === login)) { failed('su:' + ip(req)); return res.status(409).json({ error: 'That name is taken' }); }
      const id = rid(9); db.users[id] = { login, name, pw: hashPw(pw), created: now(), v: 0 }; save(); issue(req, res, id); res.json({ ok: true, user: { id, login, name } });
    });
    app.post('/api/login', (req, res) => {
      const login = clean(req.body?.login, 64).toLowerCase(), key = 'li:' + ip(req) + ':' + login;
      if (limited(key)) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });
      const hit = Object.entries(db.users).find(([, u]) => u.login === login);
      if (!hit || !checkPw(req.body?.password, hit[1].pw)) { failed(key); return res.status(401).json({ error: 'Wrong name or password' }); }
      fails.delete(key); issue(req, res, hit[0]); res.json({ ok: true, user: { id: hit[0], login, name: hit[1].name } });
    });
    app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });
    const havenBase = () => { const h = conf().haven; return h && h.url ? String(h.url).replace(/\/+$/, '') : ''; };
    const havenSeal = (b) => sign('haven.' + b);
    app.post('/api/haven/start', (req, res) => {
      const base = havenBase();
      if (!base) return res.status(404).json({ error: 'Haven sign-in is off' });
      if (req.headers['x-amni-connect'] !== '1') return res.status(403).json({ error: 'Bad request' });
      const a = crypto.randomBytes(32).toString('hex'), body = Buffer.from(JSON.stringify({ a, exp: now() + 10 * 60 * 1000 })).toString('base64url'), origin = (secure(req) ? 'https://' : 'http://') + String(req.headers.host || '').replace(/[^\w.:\-\[\]]/g, '').slice(0, 100);
      res.setHeader('Set-Cookie', `ac_haven=${body}.${havenSeal(body)}; Path=/api/haven; HttpOnly; SameSite=Lax; Max-Age=600${secure(req) ? '; Secure' : ''}`);
      const ret = /^\/(app|invite\/[\w-]{1,64})$/.test(String(req.body?.ret || '')) ? req.body.ret : '/app';
      res.json({ url: `${base}/api/auth/SSO?authCode=${a}&origin=${encodeURIComponent(origin)}&return=${encodeURIComponent(ret)}` });
    });
    app.post('/api/haven/finish', async (req, res) => {
      const base = havenBase();
      if (!base) return res.status(404).json({ error: 'Haven sign-in is off' });
      if (req.headers['x-amni-connect'] !== '1') return res.status(403).json({ error: 'Bad request' });
      const m = String(req.headers.cookie || '').match(/(?:^|;\s*)ac_haven=([^;]+)/), [body, sig] = (m ? m[1] : '').split('.');
      let p = null;
      try { p = body && sig && havenSeal(body) === sig ? JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) : null; } catch (_) {}
      if (!p || !p.a || p.exp < now()) return res.status(400).json({ error: 'That sign-in expired. Start again.' });
      let r;
      try { r = await fetch(`${base}/api/auth/SSO/authenticate?authCode=${p.a}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); } catch (_) { return res.status(502).json({ error: 'Could not reach Haven' }); }
      if (r.status === 404 || r.status === 429) return res.status(202).json({ pending: true });
      const j = await r.json().catch(() => ({})), hn = String(j.username || '').toLowerCase();
      if (!r.ok || !/^[\w.\-]{1,64}$/.test(hn)) return res.status(502).json({ error: 'Haven did not confirm the sign-in' });
      const link = String((conf().haven.link || {})[hn] || '').toLowerCase(), login = link || 'haven:' + hn, hit = Object.entries(db.users).find(([, u]) => u.login === login);
      if (!hit && link) return res.status(500).json({ error: 'The account linked to this Haven user is missing' });
      if (!hit && conf().haven.open === false) return res.status(403).json({ error: `Haven account ${j.username} is not allowed here` });
      const id = hit ? hit[0] : rid(9);
      hit || (db.users[id] = { login, name: clean(j.displayName, 48) || hn, via: 'haven', created: now(), v: 0 }, save());
      issue(req, res, id); res.json({ ok: true, user: { id, login, name: db.users[id].name } });
    });
    app.post('/api/password', (req, res) => { const u = need(req, res); if (!u) return; if (!checkPw(req.body?.current, u.pw)) return res.status(401).json({ error: 'Current password is wrong' }); if (String(req.body?.password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' }); const x = db.users[u.id]; x.pw = hashPw(req.body.password); x.v = (x.v || 0) + 1; save(); issue(req, res, u.id); res.json({ ok: true }); });
    app.get('/api/me', (req, res) => { const u = userOf(req.headers); res.json({ user: u ? { id: u.id, login: u.login, name: u.name, via: u.via || 'account' } : null, passcode: !!conf().passcode, haven: (() => { try { return havenBase() ? new URL(havenBase()).origin : ''; } catch (_) { return ''; } })() }); });
    app.post('/api/passcode', (req, res) => {
      const pc = conf().passcode, key = 'pw:' + ip(req);
      if (!pc) return res.status(404).json({ error: 'Passcode entry is off' });
      if (limited(key)) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });
      if (!checkPw(String(req.body?.code || '').trim(), pc.hash)) { failed(key); return res.status(401).json({ error: 'Wrong passcode' }); }
      fails.delete(key);
      const name = clean(req.body?.name, 32) || 'Guest', login = 'passcode:' + name.toLowerCase(), hit = Object.entries(db.users).find(([, x]) => x.login === login);
      const id = hit ? hit[0] : rid(9); db.users[id] = { ...(db.users[id] || { login, name, via: 'passcode', created: now(), v: 0 }), pc: sha(pc.hash) }; save();
      issue(req, res, id); res.json({ ok: true, user: { id, login, name, via: 'passcode' } });
    });
    app.get('/api/devices', (req, res) => { const u = need(req, res); if (!u) return; sweep(); const ids = new Set([...Object.keys(db.devices).filter((d) => db.devices[d].owner === u.id || (u.via === 'passcode' && role(u.id, d))), ...db.grants.filter((g) => g.user === u.id).map((g) => g.device)]); res.json({ devices: [...ids].filter((d) => db.devices[d]).map((d) => deviceView(d, u.id)).sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || b.online - a.online || a.name.localeCompare(b.name)) }); });
    app.post('/api/devices/pair/start', (req, res) => {
      if (limited('ps:' + ip(req))) return res.status(429).json({ error: 'Too many pairing requests' });
      failed('ps:' + ip(req)); sweep();
      const c = code(4) + '-' + code(4), poll = rid(18);
      db.pairs[c] = { name: clean(req.body?.name, 48) || 'Computer', platform: clean(req.body?.platform, 16), exp: now() + PAIR_MS, poll: sha(poll) }; save();
      res.json({ code: c, poll, expiresIn: PAIR_MS / 1000 });
    });
    app.get('/api/devices/pair/poll', (req, res) => {
      const h = sha(req.query.poll || ''), hit = Object.entries(db.pairs).find(([, p]) => p.poll === h);
      if (!hit) return res.status(404).json({ status: 'expired' });
      const [c, p] = hit; if (!p.device) return res.json({ status: 'pending' });
      delete db.pairs[c]; save(); res.json({ status: 'paired', deviceId: p.device, secret: p.secret, name: db.devices[p.device]?.name || '' });
    });
    app.post('/api/devices/pair/claim', (req, res) => {
      const u = need(req, res); if (!u) return;
      const room = clean(req.body?.code, 40).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
      if (db.devices[room]) { const r = byCode(u.id, room, ip(req)); return r.error ? res.status(429).json({ error: r.error }) : res.json({ ok: true, joined: true, device: deviceView(r.id, u.id) }); }
      const c = clean(req.body?.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2'), p = db.pairs[c];
      if (limited('pc:' + u.id) || limited('pi:' + ip(req))) return res.status(429).json({ error: 'Too many wrong codes, wait 15 minutes' });
      if (!p || p.exp < now() || p.device) { failed('pc:' + u.id); failed('pi:' + ip(req)); return res.status(404).json({ error: 'That code is wrong or expired' }); }
      const nm = clean(req.body?.name, 48) || p.name, want = nm.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32), id = /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(want) && !db.devices[want] ? want : code(10), s = rid(32); db.devices[id] = { owner: u.id, name: nm, platform: p.platform, secret: sha(s), created: now(), lastSeen: null };
      p.device = id; p.secret = s; save(); res.json({ ok: true, device: deviceView(id, u.id) });
    });
    app.patch('/api/devices/:id', (req, res) => { const o = owned(req, res); if (!o) return; o.d.name = clean(req.body?.name, 48) || o.d.name; save(); res.json({ ok: true }); });
    app.delete('/api/devices/:id', (req, res) => { const o = owned(req, res); if (!o) return; const id = req.params.id; delete db.devices[id]; db.grants = db.grants.filter((g) => g.device !== id); for (const [k, v] of Object.entries(db.invites)) if (v.device === id) delete db.invites[k]; save(); kick(id, null); res.json({ ok: true }); });
    app.get('/api/devices/:id/access', (req, res) => { const o = owned(req, res); if (!o) return; sweep(); const id = req.params.id; res.json({ guests: db.grants.filter((g) => g.device === id).map((g) => ({ user: g.user, name: db.users[g.user]?.name || '?', login: db.users[g.user]?.login || '', role: g.role, exp: g.exp || null })), invites: Object.entries(db.invites).filter(([, v]) => v.device === id).map(([k, v]) => ({ id: sha(k).slice(0, 12), role: v.role, exp: v.exp, uses: v.uses, max: v.max, label: v.label })) }); });
    app.post('/api/devices/:id/invites', (req, res) => {
      const o = owned(req, res); if (!o) return;
      const r = req.body?.role === 'view' ? 'view' : 'control', days = Math.min(INVITE_DAYS_MAX, Math.max(1, parseInt(req.body?.days, 10) || 7)), max = Math.min(50, Math.max(1, parseInt(req.body?.max, 10) || 1)), access = Math.min(365, Math.max(0, parseInt(req.body?.accessDays, 10) || 0));
      const t = rid(18); db.invites[t] = { device: req.params.id, role: r, exp: now() + days * 86400000, uses: 0, max, by: o.u.id, label: clean(req.body?.label, 40), access }; save();
      res.json({ ok: true, token: t, path: '/invite/' + t });
    });
    app.delete('/api/devices/:id/invites/:inv', (req, res) => { const o = owned(req, res); if (!o) return; for (const k of Object.keys(db.invites)) if (db.invites[k].device === req.params.id && sha(k).slice(0, 12) === req.params.inv) delete db.invites[k]; save(); res.json({ ok: true }); });
    app.delete('/api/devices/:id/guests/:user', (req, res) => { const o = owned(req, res); if (!o) return; db.grants = db.grants.filter((g) => !(g.device === req.params.id && g.user === req.params.user)); save(); kick(req.params.id, req.params.user); res.json({ ok: true }); });
    app.get('/api/invites/:token', (req, res) => { sweep(); const v = db.invites[req.params.token]; if (!v) return res.status(404).json({ error: 'This invite is expired or was revoked' }); const d = db.devices[v.device]; res.json({ device: d?.name || '', owner: db.users[v.by]?.name || '', role: v.role, exp: v.exp }); });
    app.post('/api/invites/:token/accept', (req, res) => {
      const u = need(req, res); if (!u) return; sweep();
      const v = db.invites[req.params.token]; if (!v || !db.devices[v.device]) return res.status(404).json({ error: 'This invite is expired or was revoked' });
      if (db.devices[v.device].owner === u.id) return res.json({ ok: true, device: v.device });
      db.grants = db.grants.filter((g) => !(g.device === v.device && g.user === u.id));
      db.grants.push({ device: v.device, user: u.id, role: v.role, exp: v.access ? now() + v.access * 86400000 : 0, by: v.by, at: now() });
      v.uses++; if (v.max && v.uses >= v.max) delete db.invites[req.params.token]; save(); res.json({ ok: true, device: v.device });
    });
  }
  let kick = () => {};
  const setKick = (fn) => { kick = fn; };
  const deviceAuth = (auth) => { const id = String(auth?.deviceId || ''), d = db.devices[id]; return d && auth?.secret && sha(auth.secret) === d.secret ? id : null; };
  const markOnline = (id, sock) => { online.set(id, sock); const d = db.devices[id]; if (d) { d.lastSeen = now(); save(); } };
  const markOffline = (id, sock) => { if (online.get(id) === sock) { online.delete(id); const d = db.devices[id]; if (d) { d.lastSeen = now(); save(); } } };
  return { routes, userOf, role, byCode, peerIp, ipOk, hashPw, deviceAuth, markOnline, markOffline, setKick, db };
}
module.exports = { createCloud };
