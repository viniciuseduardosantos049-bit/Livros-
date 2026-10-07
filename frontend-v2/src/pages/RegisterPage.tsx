import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ErrorBox } from '../components/ui';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/biblioteca" replace />;

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setSubmitting(true);
    try {
      await register(form.name, form.email, form.password);
      navigate('/biblioteca', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Criar conta</h1>
        <p className="sub">A biblioteca é sua: só você vê e altera os seus livros.</p>
        {error && <ErrorBox message={error} />}
        <div className="field">
          <label htmlFor="name">Nome</label>
          <input id="name" required minLength={2} value={form.name} onChange={(e) => update('name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => update('email', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Senha (mínimo 8 caracteres)</label>
          <input id="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirmar senha</label>
          <input id="confirm" type="password" autoComplete="new-password" required minLength={8} value={form.confirm} onChange={(e) => update('confirm', e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? 'Criando...' : 'Criar conta'}
        </button>
        <p className="small muted" style={{ textAlign: 'center', marginTop: '1rem', marginBottom: 0 }}>
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </form>
    </div>
  );
}
