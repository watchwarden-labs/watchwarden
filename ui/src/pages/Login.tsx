import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const setAuthToken = useStore((s) => s.setAuthToken);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError('Invalid password');
        return;
      }
      // Server sets httpOnly cookie; we just track login state in the UI.
      setAuthToken('cookie');
    } catch {
      setError('Connection failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full mx-4 sm:mx-auto sm:w-96 shadow-glow-accent">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-primary">WatchWarden</CardTitle>
          <CardDescription>Enter admin password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              autoFocus
              required
              minLength={1}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
            />
            {error && (
              <p id="login-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={!password || submitting}>
              {submitting ? 'Logging in...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
