import { t } from '../i18n';

type ApiErrorBody = {
  response?: {
    data?: {
      error?: {
        message?: string;
        code?: string;
      };
    };
  };
};

export function apiError(err: unknown, fallback: string): string {
  const message = (err as ApiErrorBody)?.response?.data?.error?.message;
  if (message) return t(message);
  if (err instanceof Error && err.message) return t(err.message);
  return t(fallback);
}

export function apiErrorCode(err: unknown): string | undefined {
  return (err as ApiErrorBody)?.response?.data?.error?.code;
}
