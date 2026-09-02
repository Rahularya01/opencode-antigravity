export type OpenCodeModelConfig = {
  name: string;
  reasoning?: boolean;
  limit?: { context: number; output: number };
  modalities?: { input: Array<"text" | "image" | "audio">; output: Array<"text" | "image"> };
  variants?: Record<string, { effort?: string }>;
};
