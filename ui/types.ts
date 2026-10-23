// The wire formats: what the agent sends (see schema.json) and what the page answers.
export type Option = string | { value: string; label?: string; md?: string };

type Base = { id: string; label: string; md?: string; required?: boolean };
export type ConfirmItem = Base & { type: "confirm"; default?: boolean };
export type SingleItem = Base & { type: "single"; options: Option[]; default?: string; other?: boolean };
export type MultiItem = Base & {
  type: "multi";
  options: Option[];
  default?: string[];
  min?: number;
  max?: number;
  other?: boolean;
};
export type ReviewItem = Base & { type: "review"; options: Option[] };
export type RankItem = Base & { type: "rank"; options: Option[] };
export type TextItem = Base & {
  type: "text";
  default?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
};
export type NumberItem = Base & {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
  step?: number;
  display?: "stepper" | "slider";
};
export type DateItem = Base & { type: "date"; time?: boolean; default?: string; min?: string; max?: string };
export type Item = ConfirmItem | SingleItem | MultiItem | ReviewItem | RankItem | TextItem | NumberItem | DateItem;

export type Mood = "confident" | "excited" | "nervous" | "begging" | "grumpy" | "sheepish";

export type Question = {
  title?: string;
  name?: string;
  md?: string;
  questions: Item[];
  deadline?: number;
  sent?: number;
  mood?: Mood;
};

// `ask say`: a one-way update, never answered
export type Say = { say: string };

// seqs: the batches an answer covers, always the first key (ask.sh matches it at the start)
export type Answer = {
  seqs?: number[];
  answers: Record<string, unknown>;
  skipped: string[];
  comments: Record<string, string>;
  note: string;
  delegated?: string[];
  declined?: true;
  error?: string;
};
