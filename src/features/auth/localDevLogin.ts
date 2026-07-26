interface LocalDevLoginConditions {
  isDevelopment: boolean;
  isLocalSupabase: boolean;
  requested: boolean;
}

export interface LocalDevLoginCredentials {
  email: string;
  password: string;
}

export function isLocalDevLoginEnabled({
  isDevelopment,
  isLocalSupabase,
  requested
}: LocalDevLoginConditions): boolean {
  return isDevelopment && isLocalSupabase && requested;
}

export function localDevLoginCredentials(isLocalSupabase: boolean): LocalDevLoginCredentials | null {
  const email = import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL?.trim();
  const password = import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD;
  if (!isLocalDevLoginEnabled({
    isDevelopment: import.meta.env.DEV,
    isLocalSupabase,
    requested: import.meta.env.VITE_DEV_AUTO_LOGIN === "true"
  }) || !email || !password) {
    return null;
  }

  return { email, password };
}
