/** Stateless, bounded LLM chat proxy. It cannot forward tool/action authority. */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import type { ServerConfig } from '../config.js';
import { validateChatBody } from './request-contract.js';
import {
  sendInvalidRequest,
  sendInvalidUpstreamResponse,
  sendLlmNotConfigured,
  sendUpstreamException,
  sendUpstreamStatusFailure,
} from './proxy-errors.js';

function buildUpstreamUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function registerV1ChatRoute(
  app: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  const { llm } = config;

  app.post('/v1/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = String(request.id);
    const validation = validateChatBody(request.body);
    if (!validation.ok) return sendInvalidRequest(reply, requestId, validation.code);
    if (!llm.apiKey) return sendLlmNotConfigured(reply, requestId);

    const body = validation.value;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), llm.timeoutMs);

    try {
      const upstream = await fetch(buildUpstreamUrl(llm.baseUrl, llm.chatPath), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${llm.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!upstream.ok) return sendUpstreamStatusFailure(request, reply, upstream.status);
      if (!upstream.body) return sendInvalidUpstreamResponse(request, reply);

      if (body.stream === true) {
        reply.header('content-type', 'text/event-stream; charset=utf-8');
        reply.header('cache-control', 'no-cache');
        reply.header('connection', 'keep-alive');
        reply.header('x-accel-buffering', 'no');
        return reply.send(
          Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream),
        );
      }

      try {
        return reply.send(await upstream.json());
      } catch {
        return sendInvalidUpstreamResponse(request, reply);
      }
    } catch (error) {
      return sendUpstreamException(request, reply, error);
    } finally {
      clearTimeout(timeoutHandle);
    }
  });
}
