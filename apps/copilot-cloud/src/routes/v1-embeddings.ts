/** Stateless, bounded embeddings proxy. No KB data is stored by this service. */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerConfig } from '../config.js';
import { validateEmbeddingsBody } from './request-contract.js';
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

export async function registerV1EmbeddingsRoute(
  app: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  const { llm } = config;

  app.post('/v1/embeddings', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = String(request.id);
    const validation = validateEmbeddingsBody(request.body);
    if (!validation.ok) return sendInvalidRequest(reply, requestId, validation.code);
    if (!llm.apiKey) return sendLlmNotConfigured(reply, requestId);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), llm.timeoutMs);
    try {
      const upstream = await fetch(buildUpstreamUrl(llm.baseUrl, llm.embeddingsPath), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${llm.apiKey}`,
        },
        body: JSON.stringify(validation.value),
        signal: controller.signal,
      });

      if (!upstream.ok) return sendUpstreamStatusFailure(request, reply, upstream.status);
      if (!upstream.body) return sendInvalidUpstreamResponse(request, reply);
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
