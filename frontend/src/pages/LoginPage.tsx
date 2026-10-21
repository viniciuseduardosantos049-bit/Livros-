import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ErrorBox } from '../components/ui';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={location.state?.from ?? '/biblioteca'} replace />;

  function preencherContaDeTeste() {
    setEmail('contademo@gmail.com');
    setPassword('Demo1234');
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from ?? '/biblioteca', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Entrar</h1>
        <p className="sub">Seu espaço para acompanhar as leituras dos livros que você já tem.</p>
        {error && <ErrorBox message={error} />}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
        <div className="conta-teste" role="note">
          <p className="small muted" style={{ margin: 0 }}>
            Só quer dar uma olhada? Use a conta de demonstração:
          </p>
          <p className="small" style={{ margin: '.3rem 0 0', fontFamily: 'monospace' }}>
            contademo@gmail.com · Demo1234
          </p>
          <button type="button" className="btn-ghost btn-sm" style={{ marginTop: '.6rem' }} onClick={preencherContaDeTeste}>
            Preencher automaticamente
          </button>
        </div>
      </form>
    </div>
  );
}
