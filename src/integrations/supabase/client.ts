// PostgREST client - Full SQL mode (no Supabase)
// Menggunakan PostgreSQL VPS dengan PostgREST + Custom Auth
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

// Tenant configuration
interface TenantConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authUrl: string;
  isPostgREST: boolean;
}

const SESSION_STORAGE_KEY = 'postgrest_auth_session';
const SERVER_STORAGE_KEY = 'aquvit_selected_server';

// Server configurations
const SERVERS: Record<string, string> = {
  'nabire': 'https://nbx.aquvit.id',
  'manokwari': 'https://mkw.aquvit.id',
};

// Hardcoded server URL for APK builds (set via environment variable)
// VITE_APK_SERVER can be: 'nabire', 'manokwari', or a full URL
const APK_SERVER = import.meta.env.VITE_APK_SERVER as string | undefined;

// In-memory session reference for token access
// This mirrors postgrestAuth.ts to avoid circular dependency
let cachedSession: { access_token: string; exp: number } | null = null;

// Helper to get JWT token from memory/storage
// Reads sessionStorage first, then falls back to localStorage because
// postgrestAuth persists shared sessions there across tabs.
function getPostgRESTToken(): string | null {
  try {
    // 1. Check cached session in memory
    if (cachedSession) {
      if (cachedSession.exp * 1000 > Date.now()) {
        return cachedSession.access_token;
      }
      // Expired, clear cache
      cachedSession = null;
    }

    // 2. Try to recover from sessionStorage first, then localStorage
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
      || localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const session = JSON.parse(stored);
    if (!session.access_token) {
      return null;
    }

    // Check if token is expired
    const tokenParts = session.access_token.split('.');
    if (tokenParts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(atob(tokenParts[1]));
    const isExpired = payload.exp * 1000 <= Date.now();
    if (isExpired) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    // Cache for future calls
    cachedSession = { access_token: session.access_token, exp: payload.exp };
    return session.access_token;
  } catch (e) {
    console.error('[Client] Error getting token:', e);
    return null;
  }
}

// Valid anon JWT for PostgREST (expires in 100 years)
// Production JWT (signed with production JWT secret)
const PROD_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImF1ZCI6ImFub24iLCJpYXQiOjE3NjYzMzM3MjgsImV4cCI6NDkyMjA5MzcyOH0.3N0XiX6YWpWpli3TuKsVx1eV0IoqXsb9_z8CER_1bR8';
// Local JWT (signed with docker-compose JWT secret: reallyreallyreallyreallyverysafeandsecurejwtsecret)
const LOCAL_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImF1ZCI6ImFub24iLCJpYXQiOjE3Njc1MzE0ODUsImV4cCI6NDkyMTEzMTQ4NX0.5fqX3eXr6VhW2vGWUUlHQxPO_ATFsJxyX6zJXqMduxs';

// Use production JWT for all connections (connect to mkw.aquvit.id)
function getAnonJWT(): string {
  const baseUrl = getBaseUrl();
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    return LOCAL_ANON_JWT;
  }
  return PROD_ANON_JWT;
}

// Check if running in Capacitor/mobile app
function isCapacitorApp(): boolean {
  // Multiple detection methods for reliability
  try {
    // Method 1: Capacitor native detection
    if (Capacitor.isNativePlatform()) {
      return true;
    }
    // Method 2: Check platform
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      return true;
    }
  } catch (e) {
    // Capacitor not available
  }

  // Method 3: Check URL scheme (capacitor:// or file://)
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    if (protocol === 'capacitor:' || protocol === 'file:') {
      return true;
    }
    // Method 4: Check if running from localhost with capacitor user agent
    if (window.location.hostname === 'localhost' &&
      navigator.userAgent.toLowerCase().includes('android')) {
      return true;
    }
  }

  return false;
}

// Get selected server from localStorage (for Capacitor app)
function getSelectedServerUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const serverId = localStorage.getItem(SERVER_STORAGE_KEY);
  if (serverId && SERVERS[serverId]) {
    return SERVERS[serverId];
  }
  return null;
}

// Check if server is selected (for Capacitor app)
// IMPORTANT: Returns false if in Capacitor and no server selected yet
export function isServerSelected(): boolean {
  if (!isCapacitorApp()) return true; // Web always has server from origin
  // If APK_SERVER is set, server is always "selected"
  if (APK_SERVER) return true;
  return getSelectedServerUrl() !== null;
}

// Get current server URL - returns null if in Capacitor and no server selected
export function getCurrentServerUrl(): string | null {
  if (typeof window === 'undefined') return null;

  if (isCapacitorApp()) {
    // In Capacitor app, return null if no server selected (to show selector)
    return getSelectedServerUrl(); // Can be null!
  } else {
    // In web browser, use current origin
    return window.location.origin;
  }
}

// Get the base URL for API calls - works for both web and APK
function getBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8080';

  // Check if we're on a production domain (web browser)
  const origin = window.location.origin;
  if (origin.includes('nbx.aquvit.id') || origin.includes('mkw.aquvit.id')) {
    return origin;
  }

  // For Capacitor/APK, check for hardcoded server first
  if (isCapacitorApp()) {
    // If APK_SERVER is set, use it (bypasses server selector)
    if (APK_SERVER) {
      // APK_SERVER can be a key like 'nabire' or a full URL
      return SERVERS[APK_SERVER] || APK_SERVER;
    }

    const selectedUrl = getSelectedServerUrl();
    if (selectedUrl) {
      return selectedUrl;
    }
    // No server selected yet - fallback to default mkw instead of crashing
    return 'https://mkw.aquvit.id';
  }

  // For localhost/development, use local proxy server for testing
  // IMPORTANT: Change this to match server you want to test against
  // 'https://nbx.aquvit.id' for Nabire
  // 'https://mkw.aquvit.id' for Manokwari
  // 'http://localhost:8090' for Local Docker testing
  return import.meta.env.VITE_POSTGREST_URL || 'http://localhost:8090';
}

function getTenantConfig(): TenantConfig {
  const baseUrl = getBaseUrl();

  // For localhost, auth server runs on separate port (3002)
  // For production, auth is on same server as PostgREST
  let authUrl = `${baseUrl}/auth`;

  // REMOVED: Hardcoded localhost override to allow connecting to VPS from local
  // if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  //   authUrl = 'http://localhost:3002/auth';
  // }

  return {
    supabaseUrl: baseUrl,
    supabaseAnonKey: getAnonJWT(), // Valid JWT for anon role (local or production)
    authUrl: import.meta.env.VITE_AUTH_URL || authUrl,
    isPostgREST: true,
  };
}

// Create Supabase-compatible client for PostgREST
// Custom fetch dynamically uses the selected server URL
function createSupabaseClient(): SupabaseClient {
  const config = getTenantConfig();

  return createClient(
    config.supabaseUrl,
    config.supabaseAnonKey,
    {
      auth: {
        persistSession: false, // We handle session ourselves
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        // Custom fetch to inject JWT token AND use dynamic base URL
        fetch: (url: RequestInfo | URL, options?: RequestInit) => {
          let finalUrl = url.toString();
          const token = getPostgRESTToken();

          // For APK: replace the base URL with the selected server
          // This is needed because supabase client is initialized once
          const currentBaseUrl = getBaseUrl();
          if (!finalUrl.startsWith(currentBaseUrl)) {
            // URL might be using old base URL, replace it
            const urlObj = new URL(finalUrl);
            const newBaseUrl = new URL(currentBaseUrl);
            urlObj.protocol = newBaseUrl.protocol;
            urlObj.host = newBaseUrl.host;
            finalUrl = urlObj.toString();
          }

          // Fix: Remove 'columns' parameter that causes 404 on PostgREST
          // Supabase JS v2.52+ sends columns with quoted values which PostgREST doesn't accept
          try {
            const urlObj = new URL(finalUrl);
            if (urlObj.searchParams.has('columns')) {
              urlObj.searchParams.delete('columns');
              finalUrl = urlObj.toString();
            }
            // For localhost: PostgREST doesn't use /rest/v1/ prefix
            // Remove the prefix for local development
            if (urlObj.hostname === 'localhost' && urlObj.pathname.startsWith('/rest/v1/')) {
              urlObj.pathname = urlObj.pathname.replace('/rest/v1/', '/');
              finalUrl = urlObj.toString();
            }
          } catch (e) {
            // URL parsing failed, continue with original URL
          }

          // Merge headers and ALWAYS override Authorization with the user token
          // when available. Supabase JS may prefill Authorization with the anon key,
          // which would make write requests run as anon and fail on protected tables.
          const headers = new Headers(options?.headers);
          if (token) {
            headers.set('Authorization', `Bearer ${token}`);
          }

          // Force Accept header for PostgREST compatibility
          // Supabase JS uses 'application/vnd.pgrst.object+json' for .single() which causes 406 error
          const currentAccept = headers.get('Accept');
          if (currentAccept?.includes('vnd.pgrst')) {
            headers.set('Accept', 'application/json');
          }

          // Handle upsert for PostgREST - convert on_conflict query param to Prefer header
          try {
            const urlObj = new URL(finalUrl);
            if (urlObj.searchParams.has('on_conflict')) {
              // PostgREST requires Prefer header for upsert, not query param
              const currentPrefer = headers.get('Prefer') || '';
              if (!currentPrefer.includes('resolution=')) {
                headers.set('Prefer', currentPrefer ? `${currentPrefer},resolution=merge-duplicates` : 'resolution=merge-duplicates');
              }
              // Remove on_conflict from URL as PostgREST uses Prefer header
              urlObj.searchParams.delete('on_conflict');
              finalUrl = urlObj.toString();
            }
          } catch (e) {
            // URL parsing failed, continue
          }

          // Ensure Prefer header includes return=representation for POST/PATCH/PUT
          // This tells PostgREST to return the inserted/updated row(s)
          const method = options?.method?.toUpperCase() || 'GET';
          if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
            const currentPrefer = headers.get('Prefer') || '';
            if (!currentPrefer.includes('return=')) {
              headers.set('Prefer', currentPrefer ? `${currentPrefer},return=representation` : 'return=representation');
            }
          }

          // Log the final URL for debugging
          // console.log('[SupabaseClient] Fetching:', finalUrl, method);

          return fetch(finalUrl, {
            ...options,
            headers,
          }).catch(err => {
            console.error('[SupabaseClient] Fetch Failed:', finalUrl, err);
            throw err;
          });
        },
      },
    }
  );
}

export const supabase: SupabaseClient = createSupabaseClient();

// Export config getter for use in auth context (dynamic)
export function getTenantConfigDynamic(): TenantConfig {
  return getTenantConfig();
}

// Legacy export for compatibility
export const tenantConfig = getTenantConfig();
export const isPostgRESTMode = true; // Always true now
