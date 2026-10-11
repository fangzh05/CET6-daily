import { useCallback, useEffect, useState } from 'react';
import type { AdminInvite, AdminOverview, AdminUser } from '../shared/contracts';
import { api, friendly } from './api';
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '—';
export const inviteState = (invite: AdminInvite) => invite.revoked_at ? '已撤销' : invite.expires_at && new Date(invite.expires_at) < new Date() ? '已过期' : invite.used_count >= invite.max_uses ? '已用完' : '可用';
export function Admin() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [note, setNote] = useState(''); const [maxUses, setMaxUses] = useState(1); const [days, setDays] = useState('7');
  const [latest, setLatest] = useState<AdminInvite | null>(null); const [copied, setCopied] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [nextOverview, nextInvites] = await Promise.all([api<AdminOverview>('/admin/overview'), api<AdminInvite[]>('/admin/invites')]);
      setOverview(nextOverview); setInvites(nextInvites);
    } catch (e) { setError(friendly(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    setBusy('create'); setError('');
    try {
      const created = await api<AdminInvite>('/admin/invites', 'POST', { max_uses: maxUses, expires_in_days: days === 'never' ? null : Number(days), note });
      setLatest(created); setNote(''); await load();
    } catch (e) { setError(friendly(e)); }
    finally { setBusy(''); }
  };
  const revoke = async (invite: AdminInvite) => {
    setBusy(invite.id); setError('');
    try { await api(`/admin/invites/${invite.id}`, 'DELETE'); await load(); }
    catch (e) { setError(friendly(e)); }
    finally { setBusy(''); }
  };
  const setStatus = async (user: AdminUser, status: 'active' | 'disabled') => {
    setBusy(user.id); setError('');
    try { await api(`/admin/users/${user.id}`, 'PATCH', { status }); await load(); }
    catch (e) { setError(friendly(e)); }
    finally { setBusy(''); }
  };
  const copy = async (invite: AdminInvite) => {
    const link = `${location.origin}/?invite=${invite.display_code ?? invite.code}`;
    try { await navigator.clipboard.writeText(`${link}\n邀请码：${invite.display_code ?? invite.code}`); setCopied(invite.id); window.setTimeout(() => setCopied(''), 2000); }
    catch { setError('复制失败，请手动记录邀请码。'); }
  };
  return <>
    <h1>管理</h1>
    <p className="muted">签发邀请码、停用或恢复账号。每个人的学习数据彼此独立，管理台只读取答题数量与活跃时间，不读取任何答案内容。</p>
    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
    {overview && <div className="stat-grid">
      <div className="panel"><span>用户</span><strong>{overview.totals.users}</strong></div>
      <div className="panel"><span>已停用</span><strong>{overview.totals.disabled}</strong></div>
      <div className="panel"><span>有效邀请码</span><strong>{overview.totals.active_invites}</strong></div>
      <div className="panel"><span>累计答题</span><strong>{overview.totals.attempts}</strong></div>
    </div>}
    <section className="panel stat-section" aria-label="邀请码">
      <div className="section-title"><h2>邀请码</h2><span className="muted">签发后把链接或邀请码发给对方</span></div>
      <form className="invite-form" onSubmit={event => { event.preventDefault(); void create(); }}>
        <label>可用次数 <select value={maxUses} onChange={event => setMaxUses(Number(event.target.value))}>{[1, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>有效期 <select value={days} onChange={event => setDays(event.target.value)}><option value="7">7 天</option><option value="30">30 天</option><option value="never">长期有效</option></select></label>
        <label className="invite-note">备注 <input value={note} maxLength={200} placeholder="给谁的，例如：小周" onChange={event => setNote(event.target.value)} /></label>
        <button className="primary" disabled={busy === 'create'}>{busy === 'create' ? '正在生成…' : '生成邀请码'}</button>
      </form>
      {latest && <div className="latest-invite" role="status">
        <div><p className="caption">新邀请码 · {latest.max_uses} 次 · {latest.expires_at ? `截止 ${formatDate(latest.expires_at)}` : '长期有效'}</p><strong>{latest.display_code ?? latest.code}</strong></div>
        <button className="secondary" onClick={() => void copy(latest)}>{copied === latest.id ? '已复制' : '复制链接'}</button>
      </div>}
      <div className="admin-table-scroll"><table>
        <thead><tr><th>邀请码</th><th>备注</th><th>使用</th><th>状态</th><th>有效期</th><th>兑换人</th><th /></tr></thead>
        <tbody>{invites.map(invite => <tr key={invite.id}>
          <td><code>{invite.display_code ?? invite.code}</code></td>
          <td>{invite.note || '—'}</td>
          <td>{invite.used_count} / {invite.max_uses}</td>
          <td>{inviteState(invite)}</td>
          <td>{invite.expires_at ? formatDate(invite.expires_at) : '长期'}</td>
          <td>{invite.redemptions?.length ? invite.redemptions.map(r => <span key={r.email} className="redemption">{r.email}<small>{formatDate(r.redeemed_at)}</small></span>) : '—'}</td>
          <td>{!invite.revoked_at && inviteState(invite) === '可用' && <button className="text-button" disabled={busy === invite.id} onClick={() => void revoke(invite)}>撤销</button>}</td>
        </tr>)}</tbody>
      </table></div>
      {!invites.length && <p className="empty">还没有邀请码。生成一个发给同学即可。</p>}
    </section>
    <section className="panel stat-section" aria-label="用户">
      <div className="section-title"><h2>用户</h2><span className="muted">停用后对方立即无法访问，数据保留</span></div>
      <div className="admin-table-scroll"><table>
        <thead><tr><th>邮箱</th><th>状态</th><th>注册时间</th><th>答题数</th><th>最近活跃</th><th /></tr></thead>
        <tbody>{overview?.users.map(user => <tr key={user.id}>
          <td>{user.email}{user.admin && <span className="badge">管理员</span>}</td>
          <td>{user.status === 'active' ? '正常' : '已停用'}</td>
          <td>{formatDate(user.created_at)}</td>
          <td>{user.attempts}</td>
          <td>{formatDate(user.last_active)}</td>
          <td>{!user.admin && (user.status === 'active'
            ? <button className="text-button" disabled={busy === user.id} onClick={() => void setStatus(user, 'disabled')}>停用</button>
            : <button className="text-button" disabled={busy === user.id} onClick={() => void setStatus(user, 'active')}>恢复</button>)}</td>
        </tr>)}</tbody>
      </table></div>
      {overview && !overview.users.length && <p className="empty">还没有用户。</p>}
    </section>
  </>;
}
