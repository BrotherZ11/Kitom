import type { Session, User } from '@supabase/supabase-js';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { toAuthErrorCode, type AuthErrorCode } from '@/features/auth/auth-errors';
import { completeAuthRedirect, getAuthRedirectUrl } from '@/features/auth/auth-redirect';
import { createAuthSessionController } from '@/features/auth/auth-session-controller';
import { authUserId, type AuthState } from '@/features/auth/auth-state';
import { secureSessionStorage } from '@/lib/secure-session-storage';
import { AUTH_STORAGE_KEY, supabase } from '@/lib/supabase';

export type AuthResult = { error: AuthErrorCode | null };
export type SignUpResult = AuthResult & { needsEmailConfirmation: boolean };

type AuthContextValue = {
  /**
   * `signed_in`: sesión utilizable. `offline`: sesión guardada en el dispositivo cuyo usuario se conoce,
   * pero que Supabase Auth no ha podido renovar ni comprobar (sin conexión, token caducado o arranque
   * lento): se muestran sus datos locales y no se envía ni se lee nada del servidor. Ver `auth-state.ts`.
   */
  status: AuthState<Session>['status'];
  /** Solo con `status === 'signed_in'`. */
  session: Session | null;
  /**
   * Usuario de la sesión (`signed_in`) o, en `offline`, el guardado en el dispositivo con esa sesión
   * (no comprobado en el servidor: solo para identificar de quién son los datos locales).
   */
  user: User | null;
  /** `true` si se puede usar el servidor como este usuario (`signed_in`). */
  canUseServer: boolean;
  /** true hasta resolver la sesión: `INITIAL_SESSION` o, como mucho, `AUTH_STARTUP_TIMEOUT_MS`. */
  isLoading: boolean;
  /** En `offline`, intenta renovar la sesión ahora (además de al volver la red o el primer plano). */
  recoverSession: () => Promise<void>;
  /**
   * Ejecuta una llamada al servidor solo si **en ese momento** hay una sesión utilizable; si no, falla
   * al instante con `SessionUnavailableError` («sin conexión»). Sin ella, supabase-js haría esperar la
   * petición a su inicialización (hasta ~30 s sin red). Función estable: usar en `queryFn`/`mutationFn`.
   */
  serverCall: <T>(call: () => Promise<T>) => Promise<T>;
  /** Sesión abierta desde un enlace de recuperación: hay que fijar una contraseña nueva. */
  isRecoveringPassword: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** Cancelar el navegador no es un error: devuelve `{ error: null }` sin sesión. */
  signInWithGoogle: () => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  /**
   * Cierra la sesión sin más comprobaciones (función estable). Llamadas simultáneas comparten el
   * mismo cierre. En la zona autenticada no se llama directamente: el cierre con cambios sin
   * sincronizar pasa por `useSignOutFlow` (`features/daily-logs/sync/`).
   */
  signOut: () => Promise<AuthResult>;
  /**
   * ¿`userId` es el usuario de la sesión vigente? Se actualiza en el mismo instante del evento de
   * Supabase Auth, antes de que React vuelva a pintar: sirve para descartar respuestas tardías de una
   * sesión anterior. Función estable.
   */
  isCurrentUser: (userId: string) => boolean;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toResult(error: unknown): AuthResult {
  if (!error) return { error: null };
  if (__DEV__) console.warn('[auth]', error);
  return { error: toAuthErrorCode(error) };
}

async function runAuthAction(action: () => Promise<{ error: unknown }>): Promise<AuthResult> {
  try {
    const { error } = await action();
    return toResult(error);
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Sesión de la app. La fuente de verdad es Supabase Auth (`onAuthStateChange`) más la sesión guardada
 * en el dispositivo cuando Supabase no puede darla sin red (`auth-session-controller.ts`); el estado
 * nunca se cambia a mano tras signIn/signOut.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [controller] = useState(() =>
    createAuthSessionController<Session>({
      auth: supabase.auth,
      storage: secureSessionStorage,
      storageKey: AUTH_STORAGE_KEY,
      subscribeOnline: (listener) => onlineManager.subscribe(listener),
      subscribeForeground: (listener) => {
        const subscription = AppState.addEventListener('change', (state) => {
          if (state === 'active') listener();
        });
        return () => subscription.remove();
      },
    })
  );
  const [state, setState] = useState(controller.getState);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  // Un solo cierre a la vez; el controlador garantiza que la sesión sale del dispositivo.
  const [signOut] = useState(() => () => runAuthAction(() => controller.signOut()));
  const [recoverSession] = useState(() => () => controller.recover());

  useEffect(() => {
    // El aviso llega en el mismo instante del cambio, antes de que React vuelva a pintar.
    const unsubscribe = controller.subscribe((next, previous, cause) => {
      const nextUserId = authUserId(next);
      const previousUserId = authUserId(previous);
      // Logout o cambio de cuenta: no reutilizar datos cacheados de otro usuario.
      if (previousUserId !== null && previousUserId !== nextUserId) queryClient.clear();
      // Sesión recuperada (misma cuenta): lo que falló sin sesión se vuelve a pedir.
      if (previous.status === 'offline' && next.status === 'signed_in' && previousUserId === nextUserId) {
        void queryClient.invalidateQueries();
      }
      if (cause === 'PASSWORD_RECOVERY') setIsRecoveringPassword(true);
      if (next.status === 'signed_out') setIsRecoveringPassword(false);
      setState(next);
    });
    const stop = controller.start();
    return () => {
      stop();
      unsubscribe();
    };
  }, [controller, queryClient]);

  const session = state.status === 'signed_in' ? state.session : null;
  // La copia guardada del usuario (misma forma que `session.user`); su id coincide con el token.
  const user = session?.user ?? (state.status === 'offline' ? (state.user as unknown as User) : null);

  const signIn = (email: string, password: string) =>
    runAuthAction(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));

  const signInWithGoogle = async (): Promise<AuthResult> => {
    try {
      const redirectTo = getAuthRedirectUrl('oauth');
      const isWeb = Platform.OS === 'web';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          // En móvil la URL se abre en una sesión de navegador del sistema que devuelve el
          // control a la app; en web el navegador navega y vuelve a /auth-callback.
          skipBrowserRedirect: !isWeb,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) return toResult(error);
      if (isWeb) return { error: null };

      const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (browserResult.type !== 'success') return { error: null };

      const redirect = await completeAuthRedirect(browserResult.url);
      return { error: redirect.status === 'error' ? redirect.error : null };
    } catch (error) {
      return toResult(error);
    }
  };

  const signUp = async (email: string, password: string): Promise<SignUpResult> => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: getAuthRedirectUrl('signup') },
      });
      if (error) return { ...toResult(error), needsEmailConfirmation: false };
      // Sin sesión = el proyecto exige confirmar el email. Con la confirmación activa, Supabase
      // tampoco revela si el email ya existía (respuesta idéntica), así que no se distingue.
      return { error: null, needsEmailConfirmation: data.session === null };
    } catch (error) {
      return { ...toResult(error), needsEmailConfirmation: false };
    }
  };

  // El enlace del email vuelve a /auth-callback, que abre una sesión de recuperación
  // (PASSWORD_RECOVERY) y la protección de rutas lleva a /update-password.
  const resetPassword = (email: string) =>
    runAuthAction(() =>
      supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthRedirectUrl('recovery'),
      })
    );

  const updatePassword = async (password: string): Promise<AuthResult> => {
    const result = await runAuthAction(() => supabase.auth.updateUser({ password }));
    if (!result.error) setIsRecoveringPassword(false);
    return result;
  };

  const value: AuthContextValue = {
    status: state.status,
    session,
    user,
    canUseServer: state.status === 'signed_in',
    isLoading: state.status === 'loading',
    recoverSession,
    serverCall: controller.serverCall,
    isRecoveringPassword,
    signIn,
    signInWithGoogle,
    signUp,
    signOut,
    isCurrentUser: controller.isCurrentUser,
    resetPassword,
    updatePassword,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return context;
}
