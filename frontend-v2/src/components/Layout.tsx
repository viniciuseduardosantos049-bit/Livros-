import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { InstallButton, OfflineBar, UpdateBar } from './PwaBanners';

// `curto` e `icone` são o que aparece na barra inferior do celular.
const links = [
  { to: '/biblioteca', label: 'Minha biblioteca', curto: 'Estante', icone: '❧' },
  { to: '/pesquisar', label: 'Pesquisar livros', curto: 'Pesquisar', icone: '⌕' },
  { to: '/anotacoes', label: 'Anotações e trechos', curto: 'Anotações', icone: '✎' },
  { to: '/estatisticas', label: 'Estatísticas', curto: 'Números', icone: '◴' },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/biblioteca" className="brand">
          <span className="dot">❧</span> Biblioteca de Leitura
        </Link>
        <nav className="nav nav-desktop">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-user">
          <InstallButton />
          <span className="nome-usuario">{user?.name}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>

      <OfflineBar />
      <UpdateBar />

      <main className="container">
        <Outlet />
      </main>

      {/* No celular a navegação vai para o polegar. */}
      <nav className="nav-mobile" aria-label="Navegação principal">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span aria-hidden>{link.icone}</span>
            {link.curto}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
