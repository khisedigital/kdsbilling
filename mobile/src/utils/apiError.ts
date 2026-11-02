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
  if (message) return message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function apiErrorCode(err: unknown): string | undefined {
  return (err as ApiErrorBody)?.response?.data?.error?.code;
}
