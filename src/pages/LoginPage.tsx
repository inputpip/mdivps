import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Package } from 'lucide-react';
import { supabase, isPostgRESTMode } from '@/integrations/supabase/client';
import { postgrestAuth } from '@/integrations/supabase/postgrestAuth';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import PageLoader from '@/components/PageLoader';

const loginSchema = z.object({
  identifier: z.string().min(1, { message: 'Username atau Email harus diisi.' }),
  password: z.string().min(1, { message: 'Password harus diisi.' }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { settings, isLoading: settingsLoading } = useCompanySettings();
  const { session, isLoading: authLoading } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (session && !authLoading) {
      navigate('/', { replace: true });
    }
  }, [session, authLoading, navigate]);

  const onSubmit = async (formData: LoginFormValues) => {
    setLoginError(null);
    setIsLoading(true);

    try {
      let email = formData.identifier;

      // Check if identifier is a username or email
      const isEmail = formData.identifier.includes('@');

      if (!isEmail) {
        // It's a username, so we need to get the email from the profiles table
        // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
        const { data: profileRaw, error: profileError } = await supabase
          .from('profiles')
          .select('email')
          .eq('username', formData.identifier)
          .order('id').limit(1);
        const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;

        if (profileError || !profile) {
          setLoginError('Username tidak ditemukan.');
          return;
        }
        email = profile.email!;
      }

      // Use appropriate auth method based on mode
      let error: Error | null = null;

      if (isPostgRESTMode) {
        const result = await postgrestAuth.signInWithPassword({
          email: email,
          password: formData.password,
        });
        error = result.error;
      } else {
        const result = await supabase.auth.signInWithPassword({
          email: email,
          password: formData.password,
        });
        error = result.error;
      }

      if (error) {
        if (error.message === 'Invalid login credentials') {
          setLoginError('Kombinasi username/email dan password salah.');
        } else {
          setLoginError(error.message);
        }
      } else {
        navigate('/', { replace: true });
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Terjadi kesalahan saat login. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading only if auth is still loading and we have a session
  if (authLoading && session) {
    return <PageLoader />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {settingsLoading && !localStorage.getItem('company_logo_cached') ? (
            <Skeleton className="mx-auto h-16 w-32" />
          ) : settings?.logo || localStorage.getItem('company_logo_cached') ? (
            <img
              src={settings?.logo || localStorage.getItem('company_logo_cached') || ''}
              alt="Company Logo"
              className="mx-auto h-16 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Package className="mx-auto h-12 w-12 text-primary" />
          )}
          <CardTitle className="text-2xl font-bold mt-4">{settings?.name || 'Aquvit POS'}</CardTitle>
          <CardDescription>Silakan masuk untuk melanjutkan</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {loginError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Login Gagal</AlertTitle>
                <AlertDescription>{loginError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="identifier">Username atau Email</Label>
              <Input
                id="identifier"
                name="identifier"
                placeholder="contoh: user_anda atau user@email.com"
                {...register('identifier')}
                autoComplete="username"
              />
              {errors.identifier && <p className="text-sm text-destructive">{errors.identifier.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                {...register('password')}
                autoComplete="current-password"
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting || isLoading}>
              {isSubmitting || isLoading ? 'Memproses...' : 'Masuk'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}