import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { request, type APIRequestContext } from '@playwright/test';
import { localStack } from './localStack';

/**
 * HTTP client for API-driven end-to-end tests that must stay on the routes
 * the interface really calls.
 *
 * Every request goes through `uiRequest`, whose method and path template are
 * checked against the catalog of endpoints called by `frontend/src`. The same
 * check runs statically in `npm run verify` (scripts/check-ui-api-contract.mjs),
 * so a test that reaches an endpoint the UI no longer uses fails before it is
 * even run, instead of keeping an orphan route covered while the real path
 * goes untested. Method and path must be literals for that static check.
 */

/** A signed-in user, as the interface holds it after logging in. */
export interface UiSession {
  nickname: string;
  userId: string;
  token: string;
}

export interface UiRequestOptions {
  /** Values for the `:name` segments of the path template. */
  params?: Record<string, string>;
  /** JSON body, sent as the axios client sends `data`. */
  body?: unknown;
  /** Query string values, as the axios client sends `params`. */
  query?: Record<string, string | number | boolean>;
  /** Status the test expects; any other status fails with the response body. */
  expectStatus?: number;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let catalog: string[] | null = null;
let context: APIRequestContext | null = null;

/** Frontend endpoint catalog, extracted once per worker by the contract script. */
function uiCatalog(): string[] {
  if (!catalog) {
    const script = path.resolve(__dirname, '../../scripts/check-ui-api-contract.mjs');
    catalog = JSON.parse(execFileSync(process.execPath, [script, '--catalog'], { encoding: 'utf8' })) as string[];
  }
  return catalog;
}

/**
 * Same key and matching rule as the contract script: parameter segments are
 * `:param`, and a catalog parameter matches any segment because the UI
 * sometimes substitutes a segment chosen at runtime.
 */
function assertUiEndpoint(method: HttpMethod, template: string): void {
  const segments = template.split('?')[0].replace(/\/+$/, '').split('/')
    .map((segment) => (segment.startsWith(':') ? ':param' : segment));
  const known = uiCatalog().some((candidate) => {
    const [candidateMethod, candidatePath] = candidate.split(' ');
    const candidateSegments = candidatePath.split('/');
    return candidateMethod === method && candidateSegments.length === segments.length
      && candidateSegments.every((segment, index) => segment === ':param' || segment === segments[index]);
  });
  if (!known) throw new Error(`${method} ${template} is not an endpoint the frontend calls`);
}

async function apiContext(): Promise<APIRequestContext> {
  if (!context) context = await request.newContext();
  return context;
}

/**
 * Send one request exactly as the frontend's axios client would: same base
 * URL, JSON body, and bearer token. Returns the parsed JSON body.
 */
export async function uiRequest<T = any>(
  session: UiSession | null,
  method: HttpMethod,
  template: string,
  options: UiRequestOptions = {},
): Promise<{ status: number; data: T }> {
  assertUiEndpoint(method, template);
  const resolved = template.replace(/:([A-Za-z]\w*)/g, (_, name: string) => {
    const value = options.params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter ${name} for ${template}`);
    return encodeURIComponent(value);
  });
  const api = await apiContext();
  const response = await api.fetch(`${localStack.apiUrl}${resolved}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    params: options.query,
    data: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const expected = options.expectStatus;
  if (expected !== undefined ? response.status() !== expected : !response.ok()) {
    throw new Error(`${method} ${resolved} returned ${response.status()}: ${text.slice(0, 500)}`);
  }
  return { status: response.status(), data };
}

/**
 * Log in through the same endpoint as the login form. Local forum users share
 * one password (E2E_PLAYER_PASSWORD, `password` by default); never point this
 * at a shared environment.
 */
export async function signIn(nickname: string): Promise<UiSession> {
  const { data } = await uiRequest<{ token: string; userId: string }>(null, 'POST', '/auth/login', {
    body: { username: nickname, password: process.env.E2E_PLAYER_PASSWORD || 'password' },
  });
  return { nickname, userId: data.userId, token: data.token };
}
