import {
  FC,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import AuthNClient from "@src/AuthNClient";
import { toUrlEncoded, generateBase58 } from "../shared/utils";
import {
  getStorageAPI,
  getSessionData,
  getSessionToken,
  getSessionTokenValues,
  getUserFromResponse,
  hasAuthParams,
  saveSessionData,
  setTokenCookies,
  removeTokenCookies,
  isTokenExpiring,
  getTokenFromCookie,
  SESSION_DATA_KEY,
  DEFAULT_COOKIE_OPTIONS,
} from "@src/shared/session";

import {
  APIResponse,
  AuthConfig,
  AuthUser,
  AppState,
  SessionData,
} from "@src/types";

import { AuthOptions, CookieOptions, VerifyResponse } from "../shared/types";

import { useValidateToken, useRefresh } from "../shared/hooks";

export interface AuthProviderProps {
  /**
   * loginUrl: string
   *
   * The url for the authn hosted UI
   */
  loginUrl: string;

  /**
   * The client config for the authn API
   *
   * See AuthConfig in types.ts for full
   * config options.
   */
  config: AuthConfig;

  /**
   * onLogin: (appState: AppState) => void
   *
   * Optional callback, called when successfully
   * logging in
   */
  onLogin?: (appState: AppState) => void;

  /**
   * cookieOptions: optional options used when setting a cookie for auth
   */
  cookieOptions?: CookieOptions;

  /**
   * redirectPathname: optional string
   *
   * When passed in, <AuthProvider /> will append this pathname to the
   * redirect URI when going through the login/logout flow
   *
   * @example
   * redirectPathname="/docs/"
   */
  redirectPathname?: string;

  /**
   * redirectOnLogout: optional boolean
   *
   * When set to true users will be redirected to the hosted logout page on logout.
   *
   * Default is false
   */
  redirectOnLogout?: boolean;

  /**
   * useStrictStateCheck: optional boolean
   *
   * When set to true AuthProvider will only accept state values generated by your application.
   *
   * Not allowing authentication flows starting from outside your application.
   *
   * Default is true
   */
  useStrictStateCheck?: boolean;

  children: JSX.Element;
}

export interface AuthContextType {
  loading: boolean;
  authenticated: boolean;
  error: string;
  user: AuthUser | undefined;
  client: AuthNClient;
  login: () => void;
  logout: () => void;
  getToken: () => string | undefined;
}

// const SESSION_DATA_KEY = "pangea-authn";
const STATE_DATA_KEY = "state";
const LAST_PATH_KEY = "last-path";

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: FC<AuthProviderProps> = ({
  loginUrl,
  config,
  onLogin,
  cookieOptions = { useCookie: false },
  redirectPathname,
  redirectOnLogout = false,
  useStrictStateCheck = true,
  children,
}) => {
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [user, setUser] = useState<AuthUser>();

  const client = useMemo(() => {
    return new AuthNClient(config);
  }, [config]);

  // For local development, use port 4000 for API and 4001 for hosted UI
  const slashRe = /\/$/;
  const loginURL = `${loginUrl.replace(slashRe, "")}/authorize`;
  const signupURL = `${loginUrl.replace(slashRe, "")}/signup`;
  const logoutURL = `${loginUrl.replace(slashRe, "")}/logout`;

  const options: AuthOptions = {
    useJwt: config.useJwt,
    sessionKey: config.sessionKey || SESSION_DATA_KEY,
    ...DEFAULT_COOKIE_OPTIONS,
    ...cookieOptions,
  };

  const validateCallback = useCallback((result: VerifyResponse) => {
    if (result.user) {
      const sessionData = getSessionData(options);

      setAuthenticated(true);
      setUser(result.user);

      if (onLogin) {
        const appState = {
          userData: sessionData.user,
          returnPath: window.location.pathname,
        };
        onLogin(appState);
      }
    } else {
      setError(result.error || "Validation failed.");
    }

    setLoading(false);
  }, []);

  const refreshCallback = useCallback((result: VerifyResponse) => {
    if (result.user) {
      setUser(result.user);
      setAuthenticated(true);
    } else {
      logout();
    }
    setLoading(false);
  }, []);

  const loadingCallback = useCallback((state: boolean) => {
    setLoading(state);
  }, []);

  const validate = useValidateToken(client, options, validateCallback);
  const { refresh, startTokenWatch, stopTokenWatch } = useRefresh(
    client,
    options,
    refreshCallback,
    loadingCallback
  );

  useEffect(() => {
    const [token, expire] = getSessionTokenValues(options);

    if (hasAuthParams()) {
      // if code and secret params are set, exchange code for a token
      exchange();
    } else if (token) {
      // if token is expiring or expired, try refreshing
      if (expire && isTokenExpiring(expire)) {
        refresh();
      } else {
        const data: SessionData = getSessionData(options);
        if (!!data.user) {
          // if token has not expired, validate that it's still good
          // Leave loading as true to allow user to still wait for a validated token
          setAuthenticated(true);
          setUser(data.user);
        }

        validate(token);
      }

      startTokenWatch();
    } else {
      // show unauthenticated state
      setLoading(false);
    }
  }, []);

  const exchange = async () => {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const storageAPI = getStorageAPI(options.useCookie);
    const savedState = storageAPI.getItem(STATE_DATA_KEY);

    const state = urlParams.get("state");
    const code = urlParams.get("code");

    // remove state and code params from the URL
    urlParams.delete("state");
    urlParams.delete("code");
    const newSearch = urlParams.toString();
    const newPath = newSearch
      ? `${window.location.pathname}?${newSearch}`
      : window.location.pathname;
    history.pushState({}, document.title, newPath);

    if (!state || !code) {
      const msg = "Missing required parameters";
      setError(msg);
      setLoading(false);
    } else if (state !== savedState && useStrictStateCheck) {
      const msg = "Invalid session state";
      setError(msg);
      setLoading(false);
    } else {
      const { success, response } = await client.userinfo(code);

      if (success) {
        const token = response.result?.active_token?.token;

        if (token) {
          // if using an opaque token or has a valid JWT
          if (!config?.useJwt || (config?.useJwt && (await validate(token)))) {
            processLogin(response);
          }
        } else {
          const msg = "Missing Token";
          setError(msg);
        }
      } else {
        setError(response.summary);
      }
      storageAPI.removeItem(STATE_DATA_KEY);
      setLoading(false);
    }
  };

  const login = () => {
    const location = window.location;
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const stateCode = generateBase58(32);
    const storageAPI = getStorageAPI(options.useCookie);
    storageAPI.setItem(STATE_DATA_KEY, stateCode);
    storageAPI.setItem(LAST_PATH_KEY, `${location.pathname}${location.search}`);

    let redirectUri = location.origin;
    if (typeof redirectPathname === "string") {
      redirectUri += redirectPathname;
    }

    const query = new URLSearchParams("");
    query.append("redirect_uri", redirectUri);
    query.append("state", stateCode);

    const queryParams = query.toString();
    const redirectTo = urlParams.get("signup") ? signupURL : loginURL;
    const url = queryParams ? `${redirectTo}?${queryParams}` : redirectTo;

    window.location.replace(url);
  };

  const logout = useCallback(async () => {
    const stateCode = generateBase58(32);

    // redirect to the hosted page
    if (redirectOnLogout) {
      let redirectUri = location.origin;

      if (typeof redirectPathname === "string") {
        redirectUri += redirectPathname;
      }

      const query = {
        redirectUri,
        state: stateCode,
      };
      const url = `${logoutURL}?${toUrlEncoded(query)}`;

      setLoggedOut();
      window.location.replace(url);
    }
    // call the logout endpoint
    else {
      const userToken = getSessionToken(options);

      if (userToken) {
        const { success, response } = await client.logout(userToken);

        if (success) {
          setLoggedOut();
        } else if (
          response?.status === "ExpiredToken" ||
          response?.status === "InvalidToken"
        ) {
          setLoggedOut();
        } else {
          setError(response.summary);
        }
      } else {
        setLoggedOut();
      }
    }
  }, []);

  const getToken = useCallback((): string | undefined => {
    return getSessionToken(options);
  }, []);

  const setLoggedOut = () => {
    if (options.useCookie) {
      removeTokenCookies(options);
    }

    stopTokenWatch();

    const storageAPI = getStorageAPI(options.useCookie);
    storageAPI.removeItem(SESSION_DATA_KEY);

    setError("");
    setUser(undefined);
    setAuthenticated(false);
  };

  const processLogin = (response: APIResponse) => {
    const user: AuthUser = getUserFromResponse(response);
    const sessionData = getSessionData(options);
    sessionData.user = user;
    saveSessionData(sessionData, options);

    const storageAPI = getStorageAPI(options.useCookie);
    const returnURL = storageAPI.getItem(LAST_PATH_KEY) || "/";

    const appState = {
      userData: user,
      returnPath: returnURL,
      authState: storageAPI.getItem(STATE_DATA_KEY),
    };

    storageAPI.removeItem(LAST_PATH_KEY);

    if (options.useCookie) {
      setTokenCookies(user, options);
    }

    setError("");
    setUser(user);
    setAuthenticated(true);

    startTokenWatch();

    if (onLogin) {
      onLogin(appState);
    }
  };

  const memoData = useMemo(
    () => ({
      authenticated,
      loading,
      error,
      user,
      client,
      login,
      logout,
      getToken,
    }),
    [authenticated, loading, error, user, client, login, logout, getToken]
  );

  return (
    <AuthContext.Provider value={memoData}>
      <>{children}</>
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};

// Convenience method and for backwards compatibility
export { getTokenFromCookie };
