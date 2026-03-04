/*
 * Helpers in this file normalize Fastify/AJV/@fastify/sensible errors (and
 * other thrown values) into a single RFC 7807 Problem Details shape so the
 * error handler plugin can return consistent `application/problem+json`
 * responses without route-specific formatting logic.
 */
import { STATUS_CODES } from 'node:http';
import type { FastifyError } from 'fastify';

// RFC 7807 problem details object:
// https://datatracker.ietf.org/doc/html/rfc7807
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
};

export type ProblemDetailsHeaders = Record<string, string>;

export type NormalizedProblemDetailsError = {
  problem: ProblemDetails;
  headers?: ProblemDetailsHeaders;
};

type FastifyErrorWithHeaders = FastifyError & {
  headers?: unknown;
};

// Error handlers may receive non-Error throws, so normalize from unknown.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Narrow to the common Fastify error shape (includes AJV validation errors and
// @fastify/sensible/http-errors produced via fastify.httpErrors.*).
function isFastifyError(value: unknown): value is FastifyErrorWithHeaders {
  return (
    isObject(value) &&
    typeof value.message === 'string' &&
    ('statusCode' in value || 'code' in value || 'validation' in value)
  );
}

// Preserve headers supplied by http-errors (for example, auth challenge headers)
// but only if they are a simple string map we can safely re-emit.
function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;

  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return undefined;
    headers[key] = entry;
  }
  return headers;
}

function getProblemStatus(error: unknown): number {
  if (isFastifyError(error) && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  if (isObject(error) && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  if (isObject(error) && typeof error.status === 'number') {
    return error.status;
  }
  return 500;
}

// RFC 7807 uses `detail` for the human-readable error message. For 5xx errors
// we avoid echoing unexpected internal messages to clients.
function getProblemDetail(
  error: unknown,
  status: number,
  fallbackTitle: string,
): string {
  if (status >= 500) return 'Internal Server Error';
  if (isFastifyError(error) && error.message) return error.message;
  if (
    isObject(error) &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return fallbackTitle;
}

// Convert any thrown value (Fastify/AJV/sensible/custom) into canonical
// RFC 7807 fields so the plugin can emit a consistent `application/problem+json`
// response body.
export function normalizeProblemDetailsError(
  error: unknown,
  instance?: string,
): NormalizedProblemDetailsError {
  const status = getProblemStatus(error);
  const title = STATUS_CODES[status] ?? 'Internal Server Error';
  const detail = getProblemDetail(error, status, title);
  const headers = isFastifyError(error)
    ? asStringRecord(error.headers)
    : undefined;

  return {
    problem: {
      // RFC 7807 default type for generic HTTP status semantics.
      type: 'about:blank',
      title,
      status,
      detail,
      ...(instance ? { instance } : {}),
    },
    ...(headers ? { headers } : {}),
  };
}
