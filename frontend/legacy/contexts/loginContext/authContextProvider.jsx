import PropTypes from "prop-types";
import authContext from "./createAuthContext";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../api";

const AuthProvider = ({ children }) => {
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [initialized, setInitialized] = useState(false);

  const activeController = useRef(null);
  const abortActiveRequest = () => {
    if (activeController.current) activeController.current.abort();
    activeController.current = new AbortController();
    return activeController.current.signal;
  };

  const getCsrfToken = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/csrf-token`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.csrfToken;
    } catch (err) {
      console.warn("getCsrfToken failed:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const tryRefresh = async () => {
      try {
        const hasRefresh = localStorage.getItem("has_refresh");
        if (!hasRefresh) {
          if (mounted) setInitialized(true);
          return;
        }

        const csrfToken = await getCsrfToken();
        const res = await fetch(`${API_BASE}/auth/refresh-token`, {
          method: "POST",
          credentials: "include",
          headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
        });

        if (!res.ok) {
          localStorage.removeItem("has_refresh");
          if (mounted) setInitialized(true);
          return;
        }
        const json = await res.json();

        if (mounted) {
          if (json.accessToken) setAccessToken(json.accessToken);
          if (json.user) setUser(json.user);
        }
      } catch (err) {
        console.warn("refresh-token failed:", err);
        localStorage.removeItem("has_refresh");
      } finally {
        if (mounted) setInitialized(true);
      }
    };
    tryRefresh();
    return () => {
      mounted = false;
      if (activeController.current) activeController.current.abort();
    };
  }, [getCsrfToken]);

  const createUser = async (userData) => {
    try {
      const csrfToken = await getCsrfToken();
      const signal = abortActiveRequest();
      const response = await fetch(`${API_BASE}/auth/sign-up`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(userData),
        credentials: "include",
        signal,
      });

      return response;
    } catch (error) {
      if (error.name !== "AbortError")
        console.error("Error creating user:", error);
      throw error;
    }
  };

  const loginUser = async (credentials) => {
    try {
      const localCart = JSON.parse(localStorage.getItem("cart") || "[]");
      const csrfToken = await getCsrfToken();
      const signal = abortActiveRequest();
      const payload = { ...credentials, localCart };

      const response = await fetch(`${API_BASE}/auth/sign-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(payload),
        credentials: "include",
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Erro ao realizar login");
      }

      setAccessToken(data.accessToken);
      setUser(data.user);
      localStorage.setItem("has_refresh", "true");

      if (data.mergedCart) {
        window.dispatchEvent(
          new CustomEvent("shop:cartMerged", { detail: data.mergedCart }),
        );
      }

      return data;
    } catch (error) {
      if (error.name !== "AbortError")
        console.error("Error logging in user:", error);
      throw error;
    }
  };

  const logoutUser = async () => {
    try {
      const csrfToken = await getCsrfToken();
      const signal = abortActiveRequest();

      const response = await fetch(`${API_BASE}/auth/sign-out`, {
        method: "POST",
        headers: csrfToken ? { "X-CSRF-Token": csrfToken } : undefined,
        credentials: "include",
        signal,
      });

      if (response.ok) {
        setAccessToken(null);
        setUser(null);
        localStorage.removeItem("cart");
        localStorage.removeItem("has_refresh");
        window.dispatchEvent(new Event("shop:logout"));
      }

      return response;
    } catch (error) {
      if (error.name !== "AbortError")
        console.error("Error logging out user:", error);
      setAccessToken(null);
      setUser(null);
      localStorage.removeItem("has_refresh");
      window.dispatchEvent(new Event("shop:logout"));
    }
  };

  const authFetch = useCallback(
    async (url, options = {}) => {
      const opts = { ...options, headers: { ...(options.headers || {}) } };
      const method = (opts.method || "GET").toUpperCase();

      if (method !== "GET" && method !== "HEAD") {
        const csrfToken = await getCsrfToken();
        if (csrfToken) opts.headers["X-CSRF-Token"] = csrfToken;
      }

      if (accessToken) {
        opts.headers["Authorization"] = `Bearer ${accessToken}`;
      }
      opts.credentials = "include";

      let res = await fetch(url, opts);

      if (res.status === 401 && accessToken) {
        try {
          const hasRefresh = localStorage.getItem("has_refresh");
          if (!hasRefresh) {
            setAccessToken(null);
            setUser(null);
            return res;
          }

          const csrfToken = await getCsrfToken();
          const refreshRes = await fetch(`${API_BASE}/auth/refresh-token`, {
            method: "POST",
            credentials: "include",
            headers: csrfToken ? { "X-CSRF-Token": csrfToken } : undefined,
          });

          if (!refreshRes.ok) {
            localStorage.removeItem("has_refresh");
            setAccessToken(null);
            setUser(null);
            return res;
          }

          const { accessToken: newToken, user: newUser } =
            await refreshRes.json();
          setAccessToken(newToken);
          if (newUser) setUser(newUser);

          const retryOpts = { ...opts, headers: { ...(opts.headers || {}) } };
          retryOpts.headers["Authorization"] = `Bearer ${newToken}`;
          res = await fetch(url, retryOpts);
        } catch (err) {
          console.warn("authFetch -> refresh failed:", err);
          localStorage.removeItem("has_refresh");
        }
      }
      return res;
    },
    [accessToken, getCsrfToken],
  );

  return (
    <authContext.Provider
      value={{
        user,
        accessToken,
        initialized,
        createUser,
        loginUser,
        logoutUser,
        authFetch,
        getCsrfToken,
      }}
    >
      {children}
    </authContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.any,
};

export default AuthProvider;
