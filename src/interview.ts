// The "skills interview" — five gstack skill lenses adapted into editorial
// questions about the article. Each lens maps a real gstack skill's
// interrogation framework onto "what would make this article better".
//
// Questions are static (no LLM, no quota): the value is the framework. The
// author's answers become editorial direction in the rewrite prompt.

export interface InterviewQuestion {
  id: string;
  q: string;
  placeholder: string;
}

export interface SkillLens {
  skill: string; // gstack skill name
  label: string; // human label for the section
  intent: string; // what this lens sharpens
  questions: InterviewQuestion[];
}

export type InterviewAnswers = Record<string, string>;

export const INTERVIEW_LENSES: SkillLens[] = [
  {
    skill: "office-hours",
    label: "Audience & Purpose",
    intent: "Who it's for and the one thing they should leave with.",
    questions: [
      {
        id: "oh_reader",
        q: "Name the exact reader: their role and the situation they're in when they find this post.",
        placeholder: "e.g. an R&D lead at a robotics startup whose pilot works but won't scale",
      },
      {
        id: "oh_question",
        q: "What specific question are they asking Google or an AI assistant that this post must answer?",
        placeholder: "e.g. how do I get my robotics demo into real production?",
      },
      {
        id: "oh_takeaway",
        q: "If they remember only ONE thing, what is it?",
        placeholder: "e.g. start with one narrow, measurable task — not the whole platform",
      },
      {
        id: "oh_action",
        q: "What do you want them to do or believe after reading?",
        placeholder: "e.g. evaluate Trossen SDK for their first deployment",
      },
    ],
  },
  {
    skill: "plan-ceo-review",
    label: "Thesis & Differentiation",
    intent: "The sharpest, most defensible version of the argument.",
    questions: [
      {
        id: "ceo_thesis",
        q: "In one sentence, what's the core argument of this piece?",
        placeholder: "e.g. Physical AI is ready for deployment if you pick the right narrow task",
      },
      {
        id: "ceo_unique",
        q: "What can Trossen credibly claim here that competitors can't?",
        placeholder: "e.g. hands-on deployment experience across hundreds of research arms",
      },
      {
        id: "ceo_10x",
        q: "What would the 10x-more-valuable version of this article include?",
        placeholder: "e.g. a real before/after deployment case study with numbers",
      },
      {
        id: "ceo_cut",
        q: "What's currently in the article you'd cut without losing the point?",
        placeholder: "e.g. the long history-of-AI preamble",
      },
    ],
  },
  {
    skill: "plan-design-review",
    label: "Structure & Readability",
    intent: "Hierarchy and scannability — what the reader sees first.",
    questions: [
      {
        id: "design_first",
        q: "What must the reader grasp in the first 5 seconds / first screen?",
        placeholder: "e.g. the 7-question readiness checklist exists and is the core value",
      },
      {
        id: "design_order",
        q: "Which sections should lead, and which are buried but shouldn't be?",
        placeholder: "e.g. move the checklist up; bury the definitions",
      },
      {
        id: "design_format",
        q: "Where would headings, bullet lists, tables, or examples help most?",
        placeholder: "e.g. turn the readiness criteria into a checklist table",
      },
    ],
  },
  {
    skill: "plan-devex-review",
    label: "Engagement & Flow",
    intent: "Time-to-value and where readers drop off.",
    questions: [
      {
        id: "dx_dropoff",
        q: "Where do readers most likely lose interest today?",
        placeholder: "e.g. the abstract intro before any concrete advice",
      },
      {
        id: "dx_level",
        q: "How technical should this be — what's the reading level for your audience?",
        placeholder: "e.g. technical decision-makers, not hands-on engineers",
      },
      {
        id: "dx_payoff",
        q: "How early must the concrete answer/payoff appear?",
        placeholder: "e.g. within the first two paragraphs",
      },
    ],
  },
  {
    skill: "spec",
    label: "Hard Requirements",
    intent: "Non-negotiables the rewrite must honor.",
    questions: [
      {
        id: "spec_facts",
        q: "Must-include facts, stats, or claims? (Only ones true to the source — the optimizer won't invent.)",
        placeholder: "e.g. cite the GAO and NIST readiness frameworks already referenced",
      },
      {
        id: "spec_keywords",
        q: "Target search queries or keywords to win on (beyond the auto-detected ones)?",
        placeholder: "e.g. 'robot deployment checklist', 'physical AI ROI'",
      },
      {
        id: "spec_cta",
        q: "Required call-to-action, links, or products to mention?",
        placeholder: "e.g. link to Trossen SDK docs; CTA to book a deployment consult",
      },
      {
        id: "spec_constraints",
        q: "Hard constraints: max length, tone, or anything to avoid?",
        placeholder: "e.g. keep under 1500 words; confident but not hypey",
      },
    ],
  },
];

/** Flatten lenses + answers into an editorial-direction block for the rewrite prompt. */
export function formatAnswers(answers: InterviewAnswers): string {
  const blocks: string[] = [];
  for (const lens of INTERVIEW_LENSES) {
    const lines = lens.questions
      .map((qq) => {
        const a = (answers[qq.id] ?? "").trim();
        return a ? `- ${qq.q}\n  -> ${a}` : null;
      })
      .filter(Boolean);
    if (lines.length) blocks.push(`### ${lens.label} (${lens.skill})\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/** True if the author actually answered at least one question. */
export function hasAnswers(answers: InterviewAnswers | undefined): boolean {
  if (!answers) return false;
  return Object.values(answers).some((v) => (v ?? "").trim().length > 0);
}
