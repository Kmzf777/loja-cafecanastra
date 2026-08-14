export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3333";

const getCsrfToken = async () => {
  const res = await fetch(`${API_BASE}/csrf-token`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Falha ao obter CSRF token");
  const { csrfToken } = await res.json();
  return csrfToken;
};

const fetchDataForm = async (url, method = "POST", body, extraOpts = {}) => {
  const csrfToken = await getCsrfToken();

  const opts = {
    method,
    credentials: "include",
    headers: {
      "X-CSRF-Token": csrfToken,
    },
    ...extraOpts,
  };

  if (method !== "GET" && method !== "HEAD") {
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }

  return fetch(`${API_BASE}${url}`, opts);
};

export default fetchDataForm;
