// The wire formats: what the agent sends (see schema.json) and what the page answers.
export type Option = string | { value: string; label?: string; md?: string };
export type Item = {
  id: string;
  type: "confirm" | "single" | "multi" | "text" | "number";
  label: string;
  md?: string;
  required?: boolean;
  options?: Option[];
  default?: any;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
};
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
// seqs: the batches an answer covers, always the first key (ask.sh matches it at the start); declined: the user chose not to answer
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
