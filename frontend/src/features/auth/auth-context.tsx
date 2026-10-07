import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { toAuthErrorCode, type AuthErrorCode } from '@/features/auth/auth-errors';
import { supabase } from '@/lib/supabase';

export type AuthResult = { error: AuthErrorCode | null };
export type SignUpResult = AuthResult & { needsEmailConfirmation: boolean };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** true hasta que Supabase ha resuelto la sesión persistida (evento INITIAL_SESSION). */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
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
 * Sesión de la app. La fuente de verdad es Supabase Auth: el estado solo se actualiza desde
 * onAuthStateChange, nunca a mano tras signIn/signOut.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Supabase emite INITIAL_SESSION al suscribirse, una vez leída (y refrescada si hace falta) la
    // sesión persistida. Usarlo como única señal de inicio evita carreras con un getSession()
    // paralelo. El callback no debe llamar a otros métodos de supabase.auth (bloquearía su lock).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (userIdRef.current !== nextUserId) {
        // Logout o cambio de cuenta: no reutilizar datos cacheados de otro usuario.
        if (userIdRef.current !== null) queryClient.clear();
        userIdRef.current = nextUserId;
      }

      setSession(nextSession);
      if (event === 'INITIAL_SESSION') setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const signIn = (email: string, password: string) =>
    runAuthAction(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));

  const signUp = async (email: string, password: string): Promise<SignUpResult> => {
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) return { ...toResult(error), needsEmailConfirmation: false };
      // Sin sesión = el proyecto exige confirmar el email. Con la confirmación activa, Supabase
      // tampoco revela si el email ya existía (respuesta idéntica), así que no se distingue.
      return { error: null, needsEmailConfirmation: data.session === null };
    } catch (error) {
      return { ...toResult(error), needsEmailConfirmation: false };
    }
  };

  // supabase-js borra la sesión local aunque falle la llamada al servidor, así que el usuario
  // siempre sale; el error solo es informativo.
  const signOut = () => runAuthAction(() => supabase.auth.signOut());

  // Sin redirectTo: el enlace usa la Site URL del proyecto. Completar el cambio de contraseña dentro
  // de la app requiere deep links (scheme + Redirect URLs en Supabase), pendiente.
  const resetPassword = (email: string) =>
    runAuthAction(() => supabase.auth.resetPasswordForEmail(email.trim()));

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    isLoading,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return context;
}
