const CHAT_FIELDS = new Set(['model', 'messages', 'stream', 'temperature', 'max_tokens']);
const MESSAGE_FIELDS = new Set(['role', 'content']);
const EMBEDDINGS_FIELDS = new Set(['model', 'input']);
const ACTION_FIELDS = new Set(['tools', 'tool_choice', 'functions', 'function_call']);

const MAX_MODEL_LENGTH = 128;
const MAX_MESSAGES = 64;
const MAX_CONTENT_LENGTH = 32_768;
const MAX_TOTAL_CONTENT_LENGTH = 131_072;
const MAX_EMBEDDING_INPUTS = 128;

export interface ChatRequestBody {
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface EmbeddingsRequestBody {
  model?: string;
  input: string | string[];
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownFieldCode(body: Record<string, unknown>, allowList: Set<string>): string | null {
  for (const key of Object.keys(body)) {
    if (ACTION_FIELDS.has(key)) return 'ACTION_FIELDS_FORBIDDEN';
    if (!allowList.has(key)) return 'REQUEST_FIELD_NOT_ALLOWED';
  }
  return null;
}

function validModel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= MAX_MODEL_LENGTH);
}

export function validateChatBody(input: unknown): ValidationResult<ChatRequestBody> {
  if (!isRecord(input)) return { ok: false, code: 'REQUEST_BODY_INVALID' };
  const fieldError = unknownFieldCode(input, CHAT_FIELDS);
  if (fieldError) return { ok: false, code: fieldError };
  if (!validModel(input.model)) return { ok: false, code: 'MODEL_INVALID' };
  if (input.stream !== undefined && typeof input.stream !== 'boolean') {
    return { ok: false, code: 'STREAM_INVALID' };
  }
  if (
    input.temperature !== undefined &&
    (typeof input.temperature !== 'number' ||
      !Number.isFinite(input.temperature) ||
      input.temperature < 0 ||
      input.temperature > 2)
  ) {
    return { ok: false, code: 'TEMPERATURE_INVALID' };
  }
  if (
    input.max_tokens !== undefined &&
    (!Number.isSafeInteger(input.max_tokens) || (input.max_tokens as number) < 1 || (input.max_tokens as number) > 8192)
  ) {
    return { ok: false, code: 'MAX_TOKENS_INVALID' };
  }
  if (!Array.isArray(input.messages) || input.messages.length < 1) {
    return { ok: false, code: 'MESSAGES_INVALID' };
  }
  if (input.messages.length > MAX_MESSAGES) {
    return { ok: false, code: 'MESSAGES_LIMIT_EXCEEDED' };
  }

  const messages: ChatRequestBody['messages'] = [];
  let totalContentLength = 0;
  for (const message of input.messages) {
    if (!isRecord(message) || unknownFieldCode(message, MESSAGE_FIELDS)) {
      return { ok: false, code: 'MESSAGE_INVALID' };
    }
    if (!['system', 'user', 'assistant'].includes(String(message.role))) {
      return { ok: false, code: 'MESSAGE_ROLE_INVALID' };
    }
    if (
      typeof message.content !== 'string' ||
      message.content.length < 1 ||
      message.content.length > MAX_CONTENT_LENGTH
    ) {
      return { ok: false, code: 'CONTENT_LIMIT_EXCEEDED' };
    }
    totalContentLength += message.content.length;
    if (totalContentLength > MAX_TOTAL_CONTENT_LENGTH) {
      return { ok: false, code: 'TOTAL_CONTENT_LIMIT_EXCEEDED' };
    }
    messages.push({
      role: message.role as ChatRequestBody['messages'][number]['role'],
      content: message.content,
    });
  }

  return {
    ok: true,
    value: {
      ...(input.model !== undefined ? { model: input.model as string } : {}),
      messages,
      ...(input.stream !== undefined ? { stream: input.stream as boolean } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature as number } : {}),
      ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens as number } : {}),
    },
  };
}

export function validateEmbeddingsBody(input: unknown): ValidationResult<EmbeddingsRequestBody> {
  if (!isRecord(input)) return { ok: false, code: 'REQUEST_BODY_INVALID' };
  const fieldError = unknownFieldCode(input, EMBEDDINGS_FIELDS);
  if (fieldError) return { ok: false, code: fieldError };
  if (!validModel(input.model)) return { ok: false, code: 'MODEL_INVALID' };

  let validatedInput: string | string[];
  if (typeof input.input === 'string') {
    if (input.input.length < 1 || input.input.length > MAX_CONTENT_LENGTH) {
      return { ok: false, code: 'INPUT_LIMIT_EXCEEDED' };
    }
    validatedInput = input.input;
  } else if (Array.isArray(input.input)) {
    if (input.input.length < 1 || input.input.length > MAX_EMBEDDING_INPUTS) {
      return { ok: false, code: 'INPUT_LIMIT_EXCEEDED' };
    }
    let totalLength = 0;
    const values: string[] = [];
    for (const value of input.input) {
      if (typeof value !== 'string' || value.length < 1 || value.length > MAX_CONTENT_LENGTH) {
        return { ok: false, code: 'INPUT_INVALID' };
      }
      totalLength += value.length;
      if (totalLength > MAX_TOTAL_CONTENT_LENGTH) {
        return { ok: false, code: 'INPUT_LIMIT_EXCEEDED' };
      }
      values.push(value);
    }
    validatedInput = values;
  } else {
    return { ok: false, code: 'INPUT_INVALID' };
  }

  return {
    ok: true,
    value: {
      ...(input.model !== undefined ? { model: input.model as string } : {}),
      input: validatedInput,
    },
  };
}
