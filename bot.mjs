// Yap Bot — TEK DOSYA. Render: Build 'npm i firebase' · Start 'node bot.mjs' · Env: YAP_TOKEN
import http from 'node:http';
import crypto from 'node:crypto';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, push, update, remove, onValue, onChildAdded, onChildRemoved, onDisconnect, query, limitToLast, serverTimestamp } from 'firebase/database';

const MAIN = process.env.YAP_DB || 'https://ksbchatsohbetproject-default-rtdb.firebaseio.com';
const chatId = (a, b) => [a, b].sort().join('__');

class YapBot {
  constructor(token) {
    this.token = String(token || ''); this.id = this.token.split('.')[0];
    this.h = {}; this.dbs = {}; this.perm = {}; this.w = {}; this.ok = false; this.start = Date.now() - 2000;
  }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const f of this.h[ev] || []) Promise.resolve().then(() => f(...a)).catch(e => this.emit('error', e)); }

  async run() {
    // Portal bu adresi çağırıp botu doğrular (Render linki = bot kaynağı linki)
    http.createServer((q, s) => {
      s.setHeader('Access-Control-Allow-Origin', '*'); s.setHeader('Content-Type', 'application/json');
      s.end(JSON.stringify({ yapBot: this.ok, id: this.id, v: 1 }));
    }).listen(process.env.PORT || 3000);

    this.db = getDatabase(initializeApp({ databaseURL: MAIN }, 'main'));
    const b = (await get(ref(this.db, `bots/${this.id}`))).val();
    if (!b || b.th !== crypto.createHash('sha256').update(this.token).digest('hex')) { this.emit('auth_problem'); return console.error('Token geçersiz.'); }
    this.ok = true;
    onValue(ref(this.db, '.info/connected'), s => { if (s.val()) { const p = ref(this.db, `bots/${this.id}/online`); onDisconnect(p).set(false); set(p, true); } });
    // Sadece Render linki doğrulanıp bot etkinleştirilince çalışır
    let live = false;
    onValue(ref(this.db, `bots/${this.id}/enabled`), s => {
      if (!s.val() || live) return; live = true;
      onChildAdded(ref(this.db, `bots/${this.id}/servers`), x => this.joinServer(x.key, x.val()));
      this.watchDms(); this.watchForms(); this.emit('connected');
    });
  }

  joinServer(sid, info) {
    const d = this.dbs[sid] ||= getDatabase(initializeApp({ databaseURL: info.url }, 'srv_' + sid), info.url);
    onValue(ref(d, '.info/connected'), s => { if (s.val()) { const p = ref(d, `yap/presence/${this.id}`); onDisconnect(p).set(false); set(p, true); } });
    onValue(ref(d, `yap/bots/${this.id}`), s => { this.perm[sid] = s.val() ? (s.val().perms || {}) : null; });
    onValue(ref(d, 'yap/channels'), s => Object.keys(s.val() || {}).forEach(ch => this.watchChannel(sid, d, ch)));
    onChildAdded(ref(d, 'yap/members'), s => { const v = s.val(); if (s.key !== this.id && v && v.joinedAt >= this.start) this.emit('message', { action: 'group/join', group_id: sid, user_id: s.key }); });
    onChildRemoved(ref(d, 'yap/members'), s => { if (s.key !== this.id) this.emit('message', { action: 'group/leave', group_id: sid, user_id: s.key }); });
  }
  watchChannel(sid, d, ch) {
    if (this.w[sid + ch]) return; this.w[sid + ch] = 1;
    onChildAdded(query(ref(d, `yap/messages/${ch}`), limitToLast(1)), s => {
      const m = s.val(); if (!m || m.from === this.id || !(m.ts >= this.start)) return;
      const t = m.text || '', base = { group_id: sid, channel_id: ch, user_id: m.from, message: t, key: s.key };
      this.emit('message', { action: 'post/add', ...base });
      if (new RegExp('@' + this.id + '\\b', 'i').test(t)) this.emit('message', { action: 'post/mention', ...base });
    });
  }
  watchDms() {
    onChildAdded(ref(this.db, `users/${this.id}/chats`), c => {
      const other = c.key;
      onChildAdded(query(ref(this.db, `chats/${chatId(this.id, other)}/messages`), limitToLast(1)), s => {
        const m = s.val(); if (!m || m.from === this.id || !(m.ts >= this.start)) return;
        this.emit('message', { action: 'message/send', user_id: other, message: m.text || '', key: s.key });
      });
    });
  }
  watchForms() {   // bumote: kullanıcı form gönderince
    onChildAdded(query(ref(this.db, `bots/${this.id}/events`), limitToLast(20)), s => {
      const e = s.val(); remove(s.ref).catch(() => {});
      if (!e || !(e.ts >= this.start)) return;
      this.emit('message', { action: 'post/bumote', user_id: e.user, group_id: e.server, channel_id: e.channel, message: { form: e.form, submit: e.submit, key: e.key } });
    });
  }

  need(gid, p) {
    const d = this.dbs[gid];
    if (!d || !this.perm[gid] || !this.perm[gid][p]) throw new Error(`Yetki yok: ${p} (${gid})`);
    return d;
  }
  // Topluyo tarzı genel API: bot.post('post.add', {...})
  async post(method, p = {}) {
    const msg = () => ({ from: this.id, bot: 1, text: String(p.message || '').slice(0, 2000), ts: serverTimestamp(), ...(p.form && { form: p.form }), ...(p.embed && { embed: p.embed }) });
    switch (method) {
      case 'messages.send':
        await push(ref(this.db, `chats/${chatId(this.id, p.user_id)}/messages`), msg());
        await set(ref(this.db, `users/${p.user_id}/chats/${this.id}`), true); return { ok: true };
      case 'post.add': { const d = this.need(p.group_id, 'send'); return { ok: true, key: (await push(ref(d, `yap/messages/${p.channel_id}`), msg())).key }; }
      case 'post.edit': await update(ref(this.need(p.group_id, 'send'), `yap/messages/${p.channel_id}/${p.key}`), { text: String(p.message).slice(0, 2000), edited: Date.now() }); return { ok: true };
      case 'post.delete': await remove(ref(this.need(p.group_id, 'manage'), `yap/messages/${p.channel_id}/${p.key}`)); return { ok: true };
      case 'channel.create': await set(ref(this.need(p.group_id, 'manage'), `yap/channels/${p.name}`), { name: p.name, type: p.type === 'voice' ? 'voice' : 'text', createdAt: Date.now() }); return { ok: true };
      case 'channel.delete': await remove(ref(this.need(p.group_id, 'manage'), `yap/channels/${p.channel_id}`)); return { ok: true };
      case 'group.members': return { ok: true, members: Object.keys((await get(ref(this.dbs[p.group_id], 'yap/members'))).val() || {}) };
      case 'group.kick': await remove(ref(this.need(p.group_id, 'kick'), `yap/members/${p.user_id}`)); return { ok: true };
      case 'user.get': return { ok: true, user: (await get(ref(this.db, `users/${p.user_id}/profile`))).val() };
      default: throw new Error('Bilinmeyen metod: ' + method);
    }
  }
  // Geldiği yere (DM ya da kanal) cevap ver
  reply(d, message, extra = {}) {
    return d.group_id && d.channel_id ? this.post('post.add', { group_id: d.group_id, channel_id: d.channel_id, message, ...extra })
      : this.post('messages.send', { user_id: d.user_id, message, ...extra });
  }
}

/* ================= BOTUN (burayı düzenle) ================= */
const bot = new YapBot(process.env.YAP_TOKEN);

bot.on('connected', () => console.log('✅ Bot hazır'));
bot.on('auth_problem', () => console.log('❌ Token geçersiz'));
bot.on('error', e => console.error('⚠️', e.message));

bot.on('message', async d => {
  const text = String(d.message || '').replace(/@\S+/g, '').trim().toLowerCase();

  if (d.action === 'group/join')                       // yeni üye
    return bot.post('post.add', { group_id: d.group_id, channel_id: 'genel', message: `Hoş geldin ${d.user_id}! 👋` });

  if (d.action === 'post/bumote')                      // form / buton cevabı
    return bot.reply(d, `Form alındı → ${JSON.stringify(d.message.form)} (${d.message.submit})`);

  if (d.action === 'post/add' && !text.startsWith('/')) return;   // kanalda sadece /komut ve @mention

  if (text.endsWith('ping')) return bot.reply(d, 'pong 🏓');
  if (text.endsWith('embed')) return bot.reply(d, '', { embed: { title: 'Merhaba!', desc: 'Ben bir Yap botuyum.', color: '#5865f2', fields: [{ name: 'Komutlar', value: 'ping · embed · form' }] } });
  if (text.endsWith('form')) return bot.reply(d, '', { form: { title: 'Anket', submit: 'Gönder', fields: [
    { id: 'renk', type: 'select', label: 'Favori renk', options: ['Kırmızı', 'Yeşil', 'Mavi'] },
    { id: 'not', type: 'text', label: 'Notun', placeholder: 'yaz…' }] } });
});

bot.run();
  
