const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

let csrfToken = "";

export function setCsrfToken(token) {
  csrfToken = token || "";
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const errorPayload = payload?.error;
    const message = errorPayload?.message
      || payload?.message
      || (typeof errorPayload === "string" ? errorPayload : null)
      || (typeof payload === "string" ? payload : null)
      || "Não foi possível concluir a operação.";
    const error = new Error(message);
    error.status = response.status;
    error.code = errorPayload?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export { API_URL };
