import {
  FC,
  ReactNode,
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
  getRefreshToken,
  getUserFromResponse,
  hasAuthParams,
  saveSessionData,
  setTokenCookies,
  removeTokenCookies,
  startTokenWatch,
  SESSION_DATA_KEY,
  DEFAULT_COOKIE_OPTIONS,
} from "@src/shared/session";
import {
  APIResponse,
  AuthUser,
  AuthOptions,
  AppState,
  AuthConfig,
  CookieOptions,
  ProviderOptions,
} from "../types";

export interface AuthContextType {
  loading: boolean;
  authenticated: boolean;
  error: string;
  user: AuthUser | undefined;
  client: AuthNClient;
  login: () => void;
  logout: (redirect?: boolean) => void;
  getToken: () => string | undefined;
}

export interface AuthProviderProps {
  /**
   * loginUrl: string
   *
   * The url for the authn hosted UI
   */
  loginUrl: string;

  /**
   * config: {
   *  domain: string
   *  token: string
   * }
   *
   * The client config for the authn API
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
   * AuthOptions: optional options for customizing auth settings
   */

  authOptions?: AuthOptions;

  /**
   * useCookie: optional boolean
   *
   * Option for using a cookie to keep the auth token around.
   * Default is false.
   *
   * When useCookie is false, we will use localStorage instead of
   * storageAPI to keep the auth token around.
   */
  useCookie?: boolean;

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
   * useStrictStateCheck: optional boolean
   *
   * When set to true AuthProvider will only accept state values generated by your application.
   *
   * Not allowing authentication flows starting from outside your application.
   *
   * Default is false
   */
  useStrictStateCheck?: boolean;

  children: ReactNode;
}

// const SESSION_DATA_KEY = "pangea-authn";
const STATE_DATA_KEY = "state";
const LAST_PATH_KEY = "last-path";

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: FC<AuthProviderProps> = ({
  loginUrl,
  config,
  onLogin,
  authOptions = {},
  useCookie = false,
  cookieOptions = {},
  redirectPathname,
  useStrictStateCheck = false,
  children,
}) => {
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [user, setUser] = useState<AuthUser>();
  const [timer, setTimer] = useState<number>();

  const client = useMemo(() => {
    return new AuthNClient(config);
  }, [config]);

  // For local development, use port 4000 for API and 4001 for hosted UI
  const slashRe = /\/$/;
  const loginURL = `${loginUrl.replace(slashRe, "")}/authorize`;
  const signupURL = `${loginUrl.replace(slashRe, "")}/signup`;
  const logoutURL = `${loginUrl.replace(slashRe, "")}/logout`;

  const options: ProviderOptions = {
    useCookie,
    sessionKey: SESSION_DATA_KEY,
    ...DEFAULT_COOKIE_OPTIONS,
    ...authOptions,
    ...cookieOptions,
  };

  useEffect(() => {
    const storageAPI = getStorageAPI(useCookie);
    const token = getSessionToken(options);

    if (hasAuthParams()) {
      // if code and secret params are set, exchange code for a token
      exchange();
    } else if (token) {
      // if token exists, check if it's valid
      validate(token);
    } else {
      // show unauthenticated state
      setLoading(false);
    }

    // clear the timer on unmount, if it's set
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  const validate = async (token: string) => {
    const refreshToken = getRefreshToken(options);

    const { success, response } = refreshToken
      ? await client.refresh(token, refreshToken)
      : await client.validate(token);

    if (success) {
      const user: AuthUser = getUserFromResponse(response);
      const sessionData = getSessionData(options);
      sessionData.user = user;

      saveSessionData(sessionData, options);
      setUser(sessionData.user);
      setAuthenticated(true);

      if (useCookie) {
        setTokenCookies(user, options);
      }

      const timerId = startTokenWatch(refresh, options);
      if (timerId) {
        setTimer(timerId);
      }

      if (onLogin) {
        const appState = {
          userData: sessionData.user,
          returnPath: window.location.pathname,
        };
        onLogin(appState);
      }
    } else {
      setError(response.summary);
    }

    setLoading(false);
  };

  const exchange = async () => {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const storageAPI = getStorageAPI(useCookie);
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
        if (response.result?.active_token?.token) {
          processLogin(response);
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
    const storageAPI = getStorageAPI(useCookie);
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

  const logout = useCallback(async (redirect = true) => {
    const stateCode = generateBase58(32);

    // redirect to the hosted page
    if (redirect) {
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
      const userToken = user?.active_token.token;

      if (userToken) {
        const { success, response } = await client.logout(userToken);

        if (success) {
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

  const refresh = async (useCookie: boolean) => {
    const sessionData = getSessionData(options);
    const activeToken = sessionData.user?.active_token?.token || "";
    const refreshToken = sessionData.user?.refresh_token?.token || "";
    const { success, response } = await client.refresh(
      activeToken,
      refreshToken
    );

    if (success) {
      const user: AuthUser = getUserFromResponse(response);
      sessionData.user = user;
      saveSessionData(sessionData, options);
      setUser(user);

      if (useCookie) {
        setTokenCookies(user, options);
      }
    } else {
      logout();
    }
  };

  const setLoggedOut = () => {
    if (useCookie) {
      removeTokenCookies(options);
    }

    if (timer) {
      clearInterval(timer);
    }

    const storageAPI = getStorageAPI(useCookie);
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

    const storageAPI = getStorageAPI(useCookie);
    const returnURL = storageAPI.getItem(LAST_PATH_KEY) || "/";

    const appState = {
      userData: user,
      returnPath: returnURL,
      authState: storageAPI.getItem(STATE_DATA_KEY),
    };

    storageAPI.removeItem(LAST_PATH_KEY);

    if (useCookie) {
      setTokenCookies(user, options);
    }

    setError("");
    setUser(user);
    setAuthenticated(true);

    const timerId = startTokenWatch(refresh, options);
    if (timerId) {
      setTimer(timerId);
    }

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
