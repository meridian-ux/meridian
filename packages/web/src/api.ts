type ApiError = Error & { payload?: unknown };

export async function apiJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      (payload as { error?: string }).error || response.statusText || 'Request failed',
    ) as ApiError;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}
