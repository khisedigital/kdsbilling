import { DEFAULT_API_URL } from './env';

let cachedUrl: string = DEFAULT_API_URL;

export async function getApiBaseUrl(): Promise<string> {
  return cachedUrl;
}

export function getCachedApiUrl(): string {
  return cachedUrl;
}

/** Internal use only — URL is fixed per build/environment */
export function setApiBaseUrl(url: string): void {
  cachedUrl = url.replace(/\/$/, '');
}
