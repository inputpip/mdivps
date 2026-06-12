/**
 * PostgREST Auth Wrapper
 * Provides Supabase-like auth interface for PostgREST mode
 */

import { getTenantConfigDynamic, isPostgRESTMode } from './client';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  user_metadata: {
    full_name: string;
  };
  app_metadata: {
    role: string;
  };
}

interface AuthSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  session_token?: string; // For single session enforcement
  user: AuthUser;
}

interface AuthResponse {
  data: { session: AuthSession | null; user: AuthUser | null } | null;
  error: Error | null;
}

const SESSION_STORAGE_KEY = 'postgrest_auth_session';

// In-memory session store for fast access
let currentSession: AuthSession | null = null;

// Helper to get stored session
// Priority: Memory -> localStorage (shared across all tabs)
function getStoredSession(): AuthSession | null {
  // 1. Return from memory if available
  if (currentSession) {
    // Validate expiration
    try {
      const tokenParts = currentSession.access_token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(atob(tokenParts[1]));
        if (payload.exp * 1000 < Date.now()) {
          // Token expired, clear everything
          currentSession = null;
          localStorage.removeItem(SESSION_STORAGE_KEY);
          return null;
        }
      }
    } catch (e) {
      // Invalid token format
      currentSession = null;
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return currentSession;
  }

  // 2. Try to recover from localStorage (shared across all tabs)
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      const session = JSON.parse(stored);
      // Validate token expiration
      const tokenParts = session.access_token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(atob(tokenParts[1]));
        if (payload.exp * 1000 < Date.now()) {
          // Token expired, clear
          localStorage.removeItem(SESSION_STORAGE_KEY);
          return null;
        }
      }
      // Valid session recovered, cache in memory
      currentSession = session;
      return session;
    }
  } catch (e) {
    console.error('Error reading stored session:', e);
  }
  return null;
}

// Helper to store session
// Stores in memory plus both web storage locations so existing client code,
// multi-tab recovery, and direct page refreshes all see the same token.
function storeSession(session: AuthSession | null) {
  // Always update memory first
  currentSession = session;

  if (session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

// Auth change listeners
type AuthChangeCallback = (event: string, session: AuthSession | null) => void;
const authListeners: Set<AuthChangeCallback> = new Set();

function notifyAuthChange(event: string, session: AuthSession | null) {
  authListeners.forEach(callback => callback(event, session));
}

/**
 * PostgREST Auth API
 */
export const postgrestAuth = {
  /**
   * Sign in with email and password
   */
  async signInWithPassword({ email, password }: { email: string; password: string }): Promise<AuthResponse> {
    const tenantConfig = getTenantConfigDynamic();
    if (!isPostgRESTMode || !tenantConfig.authUrl) {
      return { data: null, error: new Error('PostgREST mode not enabled') };
    }

    try {
      const response = await fetch(`${tenantConfig.authUrl}/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          data: null,
          error: new Error(errorData.error_description || 'Login failed'),
        };
      }

      const session: AuthSession = await response.json();
      storeSession(session);
      notifyAuthChange('SIGNED_IN', session);

      return {
        data: { session, user: session.user },
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
    }
  },

  /**
   * Get current session
   */
  async getSession(): Promise<{ data: { session: AuthSession | null }; error: null }> {
    const session = getStoredSession();
    return { data: { session }, error: null };
  },

  /**
   * Get current user
   */
  async getUser(): Promise<{ data: { user: AuthUser | null }; error: null }> {
    const session = getStoredSession();
    return { data: { user: session?.user || null }, error: null };
  },

  /**
   * Sign out
   */
  async signOut(): Promise<{ error: null }> {
    storeSession(null);
    notifyAuthChange('SIGNED_OUT', null);
    return { error: null };
  },

  /**
   * Listen for auth state changes
   */
  onAuthStateChange(callback: AuthChangeCallback): { data: { subscription: { unsubscribe: () => void } } } {
    authListeners.add(callback);

    // Immediately call with current state
    const session = getStoredSession();
    if (session) {
      setTimeout(() => callback('INITIAL_SESSION', session), 0);
    }

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            authListeners.delete(callback);
          },
        },
      },
    };
  },

  /**
   * Refresh token
   */
  async refreshSession(): Promise<AuthResponse> {
    const session = getStoredSession();
    const tenantConfig = getTenantConfigDynamic();
    if (!session || !tenantConfig.authUrl) {
      return { data: null, error: new Error('No session to refresh') };
    }

    try {
      const response = await fetch(`${tenantConfig.authUrl}/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });

      if (!response.ok) {
        storeSession(null);
        notifyAuthChange('TOKEN_REFRESHED', null);
        return { data: null, error: new Error('Token refresh failed') };
      }

      const newSession: AuthSession = await response.json();
      storeSession(newSession);
      notifyAuthChange('TOKEN_REFRESHED', newSession);

      return {
        data: { session: newSession, user: newSession.user },
        error: null,
      };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  },

  /**
   * Get access token for API requests
   */
  getAccessToken(): string | null {
    const session = getStoredSession();
    return session?.access_token || null;
  },

  /**
   * Validate if current session is still active (not kicked by another login)
   * Returns { valid: true } if session is active, { valid: false, kicked: true } if kicked
   */
  async validateSession(): Promise<{ valid: boolean; kicked?: boolean; error?: string }> {
    const session = getStoredSession();
    const tenantConfig = getTenantConfigDynamic();

    if (!session || !tenantConfig.authUrl) {
      return { valid: false, error: 'No session' };
    }

    try {
      const response = await fetch(`${tenantConfig.authUrl}/v1/session/validate`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();

      if (!result.valid && result.kicked) {
        // Session was kicked - auto logout
        storeSession(null);
        notifyAuthChange('SIGNED_OUT', null);
        return { valid: false, kicked: true, error: result.error_description };
      }

      return result;
    } catch (error) {
      // Network error - don't logout, just return invalid
      return { valid: false, error: 'Network error' };
    }
  },

  /**
   * Create a new user (admin only)
   */
  async createUser({ email, password, full_name, role }: {
    email: string;
    password: string;
    full_name: string;
    role?: string;
  }): Promise<{ data: { user: AuthUser | null }; error: Error | null }> {
    const tenantConfig = getTenantConfigDynamic();
    if (!isPostgRESTMode || !tenantConfig.authUrl) {
      return { data: { user: null }, error: new Error('PostgREST mode not enabled') };
    }

    const token = this.getAccessToken();
    if (!token) {
      return { data: { user: null }, error: new Error('Not authenticated') };
    }

    try {
      const response = await fetch(`${tenantConfig.authUrl}/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ email, password, full_name, role: role || 'user' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          data: { user: null },
          error: new Error(errorData.error || errorData.error_description || 'Failed to create user'),
        };
      }

      const result = await response.json();
      return {
        data: { user: result.user },
        error: null,
      };
    } catch (error) {
      return {
        data: { user: null },
        error: error as Error,
      };
    }
  },

  /**
   * Reset password for a user (admin only)
   * In PostgREST mode, this returns a message that admin should reset directly
   */
  async resetPasswordForEmail(email: string): Promise<{ error: Error | null }> {
    const tenantConfig = getTenantConfigDynamic();
    if (!isPostgRESTMode || !tenantConfig.authUrl) {
      return { error: new Error('PostgREST mode not enabled') };
    }

    try {
      const response = await fetch(`${tenantConfig.authUrl}/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          error: new Error(errorData.error_description || 'Password reset failed'),
        };
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  /**
   * Admin reset password for specific user (admin only)
   * Directly sets new password without email verification
   */
  async adminResetPassword(userId: string, newPassword: string): Promise<{ data: any; error: Error | null }> {
    const tenantConfig = getTenantConfigDynamic();
    if (!isPostgRESTMode || !tenantConfig.authUrl) {
      return { data: null, error: new Error('PostgREST mode not enabled') };
    }

    const token = this.getAccessToken();
    if (!token) {
      return { data: null, error: new Error('Not authenticated') };
    }

    try {
      const response = await fetch(`${tenantConfig.authUrl}/v1/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          data: null,
          error: new Error(errorData.error || errorData.error_description || 'Password reset failed'),
        };
      }

      const result = await response.json();
      return { data: result, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  },
};

/**
 * Export helper to get auth headers for PostgREST requests
 */
export function getPostgRESTAuthHeaders(): Record<string, string> {
  const token = postgrestAuth.getAccessToken();
  if (token) {
    return {
      'Authorization': `Bearer ${token}`,
    };
  }
  return {};
}
