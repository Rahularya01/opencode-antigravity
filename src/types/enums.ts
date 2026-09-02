export enum Platform {
  Linux = "LINUX",
  Macos = "MACOS",
  Windows = "WINDOWS",
}

export enum GeminiRole {
  User = "user",
  Model = "model",
}

export enum AntigravityRequestType {
  Agent = "AGENT",
  Chat = "CHAT",
}

export enum AntigravityUserAgent {
  Antigravity = "antigravity",
}

export enum GeminiToolCallingMode {
  Auto = "AUTO",
  Any = "ANY",
  None = "NONE",
  Validated = "VALIDATED",
}

export enum StopReason {
  Stop = "stop",
  Length = "length",
  ToolUse = "toolUse",
  Error = "error",
  Aborted = "aborted",
}

export enum ThinkingEffort {
  Off = "off",
  Minimal = "minimal",
  Low = "low",
  Medium = "medium",
  High = "high",
  XHigh = "xhigh",
  Max = "max",
}
