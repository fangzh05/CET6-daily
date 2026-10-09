import type { Stats } from '../shared/contracts';
const percent=(n:number,d:number)=>d?`${Math.round(n/d*100)}%`:'—';
const kinds={careful:'仔细阅读',matching:'长篇匹配',cloze:'选词填空'};
export const categories={vocabulary:'词汇不认识',sentence:'长难句理解错误',locating:'定位错误',inference:'推断错误',distractor:'干扰项误判',time:'时间不足'};
export function StatsView({stats:s}:{stats:Stats}) {
  return <><h1>学习统计</h1><p className="muted">新题看第一次，复习看每一次。日期按北京时间统计。</p><div className="stat-grid"><div className="panel"><span>今日 / 本周题数</span><strong>{s.today_count} / {s.week_count}</strong></div><div className="panel"><span>近 7 天首次正确率</span><strong>{percent(s.first_correct,s.first_count)}</strong></div><div className="panel"><span>复习正确率</span><strong>{percent(s.review_correct,s.review_count)}</strong></div><div className="panel"><span>首次平均作答时间</span><strong>{s.first_count?`${Math.round(s.average_ms/1000)} 秒`:'—'}</strong></div></div>
    <section className="panel stat-section"><h2>首次作答趋势 · 最近 7 天</h2>{s.trend.length?<table><thead><tr><th>日期</th><th>完成</th><th>正确率</th></tr></thead><tbody>{s.trend.map(r=><tr key={r.day}><td>{r.day}</td><td>{r.count} 题</td><td>{percent(r.correct,r.count)}</td></tr>)}</tbody></table>:<p className="empty">暂无首次作答记录</p>}</section>
    <div className="two-column"><section className="panel stat-section"><h2>各题型 · 首次作答</h2>{s.by_kind.length?s.by_kind.map(k=><div className="data-row" key={k.kind}><span>{kinds[k.kind]}</span><strong>{percent(k.correct,k.count)} <small>· {k.count} 题</small></strong></div>):<p className="empty">暂无题型记录</p>}</section><section className="panel stat-section"><h2>错误原因</h2>{s.errors.length?s.errors.map(e=><div className="data-row" key={e.category??'none'}><span>{categories[e.category as keyof typeof categories]??'尚未分类'}</span><strong>{e.count}</strong></div>):<p className="empty">暂无错题记录</p>}</section></div>
    <section className="panel stat-section"><h2>真题年份覆盖</h2>{s.by_year.length?s.by_year.map(y=><div className="data-row" key={y.year}><span>{y.year} 年</span><span>{y.count} / {y.total} 道可练习题目</span></div>):<p className="empty">导入已核验题组后开始统计</p>}</section>
    <p className="muted">本周学习 {Math.round(s.week_ms/60000)} 分钟 · 今日已复习 {s.review_completion.completed} 题 · 仍有 {s.review_completion.due} 题到期</p>
  </>;
}
