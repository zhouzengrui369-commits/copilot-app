import type { FastifyReply, FastifyRequest } from 'fastify';

export function sendInvalidRequest(
  reply: FastifyReply,
  requestId: string,
  code: string,
) {
  return reply.code(400).send({ error: 'invalid_request', code, requestId });
}

export function sendLlmNotConfigured(reply: FastifyReply, requestId: string) {
  return reply.code(503).send({
    error: 'llm_not_configured',
    code: 'LLM_NOT_CONFIGURED',
    requestId,
  });
}

export function sendUpstreamStatusFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  upstreamStatus: number,
) {
  const requestId = String(request.id);
  const code = upstreamStatus === 401 || upstreamStatus === 403
    ? 'UPSTREAM_AUTH_FAILED'
    : upstreamStatus === 429
      ? 'UPSTREAM_RATE_LIMITED'
      : upstreamStatus >= 500
        ? 'UPSTREAM_UNAVAILABLE'
        : 'UPSTREAM_REJECTED';
  const statusCode = upstreamStatus === 429 ? 503 : 502;
  request.log.warn({ code, requestId, statusCode }, 'LLM upstream rejected request');
  return reply.code(statusCode).send({ error: 'llm_proxy_failed', code, requestId });
}

export function sendUpstreamException(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  const requestId = String(request.id);
  const isTimeout = error instanceof Error && error.name === 'AbortError';
  const code = isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE';
  const statusCode = isTimeout ? 504 : 502;
  request.log.error({ code, requestId, statusCode }, 'LLM upstream request failed');
  return reply.code(statusCode).send({ error: 'llm_proxy_failed', code, requestId });
}

export function sendInvalidUpstreamResponse(request: FastifyRequest, reply: FastifyReply) {
  const requestId = String(request.id);
  const code = 'UPSTREAM_RESPONSE_INVALID';
  request.log.error({ code, requestId, statusCode: 502 }, 'LLM upstream response invalid');
  return reply.code(502).send({ error: 'llm_proxy_failed', code, requestId });
}
