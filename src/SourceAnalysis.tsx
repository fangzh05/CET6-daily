import type { ReactNode } from 'react';
const labels:Record<string,string>={blocks:'逐题解析',writing:'写作解析',essay:'参考范文',essay_zh:'参考译文',paragraphs:'范文',word_count:'词数',note:'说明',breakdown:'逐段拆解',facts:'审题',points:'要点',outline:'谋篇',rubric:'阅卷自检',directions:'题目要求',core:'要点',detail:'详解',text:'说明',options:'选项分析',letter:'选项',word:'词语',correct:'判断',judge:'判定',flag:'判定',pairs:'原文与选项',orig:'原文',opt:'选项',rivals:'干扰项',why:'原因',ref:'段落',en:'原文',zh:'译文',chunks:'翻译意群',role:'结构',key:'采分点',literal:'直译',difficulty:'难点',neighbor:'相邻段',relation:'关系',from:'前文',to:'后文',explain:'说明',stem_zh:'题干译文',options_zh:'选项译文',sentence:'翻译原句',dimension:'维度',label:'条目',part_c_context:'翻译背景',source:'来源',topic:'主旨'};
function render(value:unknown,key='',depth=0):ReactNode{
  if(value===null||value===undefined)return null;
  if(typeof value!=='object')return <p style={{whiteSpace:'pre-wrap'}}>{key&&<strong>{labels[key]??key}： </strong>}{typeof value==='boolean'?(value?'正确':'错误'):String(value)}</p>;
  if(Array.isArray(value))return <div>{value.map((item,i)=><div key={i}>{render(item,'',depth+1)}</div>)}</div>;
  const row=value as Record<string,unknown>;return <section>{typeof row.tag==='string'&&<h4>{row.tag}</h4>}{Object.entries(row).filter(([k])=>!['type','tag','question_id','number','kind','answer','answer_word','page_url','qtype'].includes(k)).map(([k,v])=><div key={k}>{typeof v==='object'&&v!==null&&<h4>{labels[k]??k}</h4>}{render(v,k,depth+1)}</div>)}</section>;
}
export function SourceAnalysis({analysis}:{analysis:unknown}){return <div className="source-analysis">{render(analysis)}</div>;}
