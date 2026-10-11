import { useState } from 'react';
import type { Me } from '../shared/contracts';
import { api, friendly } from './api';
import type { Theme } from './theme';
// Rendered instead of the app when Access has verified the email but no active
// account exists yet: either an invite must be redeemed, or the account was
// disabled by an administrator.
export function AccessGate({ me, theme, onRefresh }:{ me: Me; theme: Theme; onRefresh: () => Promise<void> }) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('invite') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const redeem = async () => {
    setBusy(true); setError('');
    try { await api('/access/redeem', 'POST', { code: code.trim() }); history.replaceState(null, '', location.pathname); await onRefresh(); }
    catch (e) { setError(friendly(e)); }
    finally { setBusy(false); }
  };
  return <div className="app-shell" data-theme={theme}>
    <header className="topbar"><span className="brand">CET6 <span>Daily</span></span></header>
    <main className="gate">
      <p className="home-eyebrow">CET6 DAILY</p>
      {me.status === 'disabled' ? <>
        <h1>账号已停用</h1>
        <p className="muted">当前邮箱 <strong>{me.email}</strong> 的账号已被管理员停用。如果这是误会，请联系管理员恢复后再登录。</p>
      </> : <>
        <h1>激活你的账号</h1>
        <p className="muted">当前登录邮箱是 <strong>{me.email}</strong>。输入管理员发给你的邀请码即可开始使用。每个人的学习记录、笔记与错题完全独立。</p>
        <form className="gate-form" onSubmit={event => { event.preventDefault(); void redeem(); }}>
          <input aria-label="邀请码" placeholder="邀请码，例如 CET6-7Q2M-9XKF-3BTV" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} />
          <button className="primary" disabled={busy || code.trim().length < 4}>{busy ? '正在激活…' : '激活账号'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </>}
      <div className="gate-actions">
        {me.logout_url && <a className="text-button" href={me.logout_url}>换个邮箱登录</a>}
      </div>
      <p className="caption gate-note">邀请码由管理员在管理台签发，可设置使用次数与有效期。</p>
    </main>
  </div>;
}
