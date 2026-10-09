// MOCK ONLY. Never use for production bank data. Loaded after prototype submission.
import type { ReadingQuestionReview } from './types';
const reviews:ReadingQuestionReview[]=[
  {
    "questionId": "bench-q1",
    "correctOptionId": "B",
    "evidence": [
      {
        "paragraphId": "purpose",
        "text": "The aim was to make familiar journeys possible for people who could not comfortably walk the whole distance without stopping."
      }
    ],
    "explanation": "项目解决的是日常步行途中缺少休息点的问题，B 是对项目目的的准确概括。",
    "distractorExplanations": {
      "A": "没有替代公共交通的计划。",
      "C": "项目针对居民日常出行而非旅游。",
      "D": "原文强调可达性而非竞技运动。"
    }
  },
  {
    "questionId": "bench-q2",
    "correctOptionId": "A",
    "evidence": [
      {
        "paragraphId": "observation",
        "text": "They marked the points where participants slowed down, leaned against a wall or looked for somewhere to sit."
      }
    ],
    "explanation": "实地同行用于识别真实休息需求，观察行为比单纯统计长椅数量更有用。",
    "distractorExplanations": {
      "B": "并非比较年龄组的速度。",
      "C": "没有劝居民完全放弃开车。",
      "D": "选址依据是需要而非景色。"
    }
  },
  {
    "questionId": "bench-q3",
    "correctOptionId": "C",
    "evidence": [
      {
        "paragraphId": "confidence",
        "text": "The possibility of stopping, rather than the act of stopping itself, had expanded her confidence."
      }
    ],
    "explanation": "护士不一定每次坐下；知道可以休息本身就改变了她对出行的信心。",
    "distractorExplanations": {
      "A": "没有测量体能变化。",
      "B": "不是用社交代替购物。",
      "D": "她选择路线的原因是有休息保障。"
    }
  },
  {
    "questionId": "bench-q4",
    "correctOptionId": "D",
    "evidence": [
      {
        "paragraphId": "maintenance",
        "text": "A bench that was broken or surrounded by rubbish quickly stopped being a dependable resting place."
      },
      {
        "paragraphId": "conclusion",
        "text": "Small pieces of infrastructure become valuable when someone keeps noticing whether they work."
      }
    ],
    "explanation": "两处证据共同说明设施价值来自持续维护和观察，而不仅是安装。",
    "distractorExplanations": {
      "A": "维护发现直接否定只重安装。",
      "B": "结尾强调当地具体问题。",
      "C": "结尾仍强调人的观察。"
    }
  },
  {
    "questionId": "bench-q5",
    "correctOptionId": "A",
    "evidence": [],
    "explanation": "作者认可项目的实用价值，同时指出评估局限。此题为整体语气概括，fixture 故意不提供精确锚点，以验证缺失证据的降级显示。",
    "distractorExplanations": {
      "B": "作者明确否定长椅能解决一切。",
      "C": "对小型设施持支持态度。",
      "D": "游客不是讨论重点。"
    }
  }
];
export default reviews;
