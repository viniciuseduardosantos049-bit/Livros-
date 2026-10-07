import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import RegistrarLeitura from './RegistrarLeitura';
import { OfflineBar, UpdateBar } from './PwaBanners';

/**
 * Casca de aplicativo de celular.
 *
 * Diferente da versão web, aqui não há barra no topo nem navegação por menu: as
 * abas ficam embaixo, ao alcance do polegar, e cada tela ocupa a altura inteira
 * com rolagem própria. No desktop a mesma casca vira uma faixa central estreita,
 * em vez de esticar — o layout foi desenhado para uma coluna.
 *
 * O botão central não é uma aba: registrar progresso é a ação que se repete toda
 * vez que alguém fecha o livro, então ela fica no lugar mais acessível da tela
 * em vez de ficar escondida dentro do detalhe de cada livro.
 */
const abas = [
  { to: '/biblioteca', curto: 'Estante', icone: '▤' },
  { to: '/pesquisar', curto: 'Buscar', icone: '⌕' },
  { to: '/anotacoes', curto: 'Notas', icone: '✎' },
  { to: '/estatisticas', curto: 'Você', icone: '◴' },
];

export default function Layout() {
  const [registrando, setRegistrando] = useState(false);

  return (
    <div className="app">
      <OfflineBar />
      <UpdateBar />

      <main className="tela">
        <Outlet />
      </main>

      <nav className="abas" aria-label="Navegação principal">
        {abas.slice(0, 2).map((aba) => (
          <NavLink key={aba.to} to={aba.to} className={({ isActive }) => (isActive ? 'aba ativa' : 'aba')}>
            <span className="aba-icone" aria-hidden>{aba.icone}</span>
            <span className="aba-texto">{aba.curto}</span>
          </NavLink>
        ))}

        <button
          type="button"
          className="aba-acao"
          onClick={() => setRegistrando(true)}
          aria-label="Registrar leitura"
        >
          <span aria-hidden>+</span>
        </button>

        {abas.slice(2).map((aba) => (
          <NavLink key={aba.to} to={aba.to} className={({ isActive }) => (isActive ? 'aba ativa' : 'aba')}>
            <span className="aba-icone" aria-hidden>{aba.icone}</span>
            <span className="aba-texto">{aba.curto}</span>
          </NavLink>
        ))}
      </nav>

      {registrando && <RegistrarLeitura onFechar={() => setRegistrando(false)} />}
    </div>
  );
}
