import type { Server } from "node:http";
import type { GeminiRole, StopReason } from "./enums.js";

export interface AntigravityOAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  projectId?: string;
  email?: string;
}

export interface CallbackServer {
  server: Server;
  waitForCode: () => Promise<{ code: string; state: string }>;
  cleanup: () => void;
}

export interface DynamicModelInfo {
  available: boolean;
  runtimeModel?: string;
  quotaGroup?: string;
  resetTime?: string;
  raw?: Record<string, unknown>;
}

export interface GeminiTextPart {
  text: string;
  thought?: boolean;
  thoughtSignature?: string;
}

export interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args?: Record<string, unknown>;
    id?: string;
    thought_signature?: string;
  };
  thoughtSignature?: string;
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
    id?: string;
  };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

export interface GeminiContent {
  role: GeminiRole;
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  parametersJsonSchema?: unknown;
  response?: Record<string, unknown>;
}

export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

export interface GeminiGenerationConfig {
  candidateCount?: number;
  stopSequences?: string[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  thinkingConfig?: {
    thinkingBudget?: number;
    includeThoughts?: boolean;
    thinkingLevel?: string;
  };
}

export interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: {
    role?: GeminiRole;
    parts: Array<{ text: string }>;
  };
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: string;
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: GeminiGenerationConfig;
  sessionId?: string;
  labels?: Record<string, string>;
}

export interface AntigravityGenerateRequest {
  project?: string;
  model: string;
  request: GeminiRequestBody;
  requestType?: string;
  userAgent?: string;
  requestId?: string;
}

export interface StreamChunkCandidate {
  content?: {
    parts?: Array<{
      text?: string;
      thought?: boolean;
      thoughtSignature?: string;
      functionCall?: {
        name: string;
        args?: Record<string, unknown>;
        id?: string;
        thought_signature?: string;
      };
    }>;
  };
  finishReason?: string;
}

export interface StreamChunk {
  candidates?: StreamChunkCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  response?: StreamChunk;
}

export type AntigravityStreamEvent =
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; content: string; thoughtSignature?: string }
  | {
      type: "toolcall_start";
      contentIndex: number;
      id: string;
      name: string;
    }
  | {
      type: "toolcall_delta";
      contentIndex: number;
      id: string;
      delta: string;
    }
  | {
      type: "toolcall_end";
      toolCall: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        thoughtSignature?: string;
      };
    }
  | {
      type: "done";
      reason: StopReason;
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        /** Only set when the backend reports one; Gemini usageMetadata has no such field. */
        cacheWrite?: number;
        total: number;
      };
    }
  | {
      type: "error";
      error: { errorMessage: string; status?: number };
    };
