import { useEffect, useState } from 'react';
import {
  EVENTO_INSTALAVEL,
  ehAndroid, ehIos, instalar, podeInstalar, rodandoInstalado,
} from '../pwa';

/** Ícone de compartilhar do iOS: quadrado com seta para cima. Não existe como glifo Unicode confiável. */
function IconeCompartilharIos({ tamanho = 15 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v13" />
      <path d="M8 6l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

/** "Adicionar à Tela de Início": quadrado com um mais dentro. */
function IconeAdicionar({ tamanho = 20 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function Seta() {
  return (
    <svg className="passo-seta" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/**
 * O caminho do iOS é manual e tem três toques em lugares diferentes — descrito
 * em prosa, vira um parágrafo que ninguém lê. Em passos ilustrados, cada toque
 * fica reconhecível antes da leitura.
 *
 * A barra do Safari aparece desenhada embaixo, apontada por uma seta, porque o
 * botão de compartilhar fica lá e é o passo que as pessoas não encontram.
 */
function PassosIos() {
  return (
    <>
      <ol className="passos">
        <li className="passo">
          <span className="passo-tile" aria-hidden><IconeCompartilharIos tamanho={20} /></span>
          <span className="passo-texto">Toque em<br /><b>Compartilhar</b></span>
        </li>
        <Seta />
        <li className="passo">
          <span className="passo-tile" aria-hidden><IconeAdicionar /></span>
          <span className="passo-texto">Toque em<br /><b>Adicionar à Tela de Início</b></span>
        </li>
        <Seta />
        <li className="passo">
          <span className="passo-tile passo-tile-fim" aria-hidden>OK</span>
          <span className="passo-texto">Toque em<br /><b>Adicionar</b></span>
        </li>
      </ol>

      {/* A seta aponta para a barra do navegador, que no iPhone fica embaixo. */}
      <div className="passo-apontador" aria-hidden />

      <div className="barra-safari" aria-hidden>
        <span className="barra-botao">‹</span>
        <span className="barra-url">
          <span className="barra-linhas" />
          {location.hostname}
          <span className="barra-recarregar">⟳</span>
        </span>
        <span className="barra-botao">⧉</span>
      </div>
    </>
  );
}

/**
 * Convite de instalação que aparece sozinho na primeira visita, sem esperar
 * que o usuário navegue até a aba Você.
 *
 * Modal central, não faixa discreta: é a opção que mais converte. Dispensar
 * não guarda silêncio — volta a aparecer em toda visita, até o app ser
 * instalado de fato (pedido explícito: o usuário quer ser lembrado sempre).
 *
 * Fica fora da área autenticada de propósito: a maior parte de quem chega ao
 * site pela primeira vez cai na tela de login, e é ali — antes mesmo de criar
 * conta — que vale mostrar "isto também é um app".
 *
 * Só em Android e iOS. Instalação de app não é um conceito que se aplica bem
 * ao navegador de desktop, e insistir nisso ali seria ruído.
 */
export default function InstalarAoAbrir() {
  const [visivel, setVisivel] = useState(false);
  const [podeInstalarAgora, setPodeInstalarAgora] = useState(podeInstalar());

  const noIos = ehIos();
  const noAndroid = ehAndroid();

  useEffect(() => {
    if (!noIos && !noAndroid) return;
    if (rodandoInstalado()) return;

    // Pequeno atraso: a primeira coisa que a tela mostra deve ser a própria
    // tela, não um modal por cima dela.
    const espera = setTimeout(() => setVisivel(true), 1400);
    return () => clearTimeout(espera);
  }, [noIos, noAndroid]);

  useEffect(() => {
    const aviso = () => setPodeInstalarAgora(podeInstalar());
    window.addEventListener(EVENTO_INSTALAVEL, aviso);
    return () => window.removeEventListener(EVENTO_INSTALAVEL, aviso);
  }, []);

  useEffect(() => {
    if (!visivel) return undefined;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') dispensar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel]);

  if (!visivel) return null;

  function dispensar() {
    setVisivel(false);
  }

  async function instalarAgora() {
    const aceitou = await instalar();
    if (aceitou) setVisivel(false);
  }

  return (
    <div
      className="instalar-fundo"
      role="presentation"
      onClick={dispensar}
    >
      <div
        className="instalar-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Instalar o aplicativo"
        onClick={(e) => e.stopPropagation()}
      >
        {noIos ? (
          <header className="instalar-topo">
            <img className="instalar-marca" src="/icons/icon-192.png" alt="" />
            <div className="instalar-titulos">
              <strong className="instalar-titulo">Instalar a Biblioteca</strong>
              <span className="small muted">Siga os passos abaixo</span>
            </div>
            <button type="button" className="instalar-fechar" onClick={dispensar} aria-label="Fechar">×</button>
          </header>
        ) : (
          <>
            <div className="instalar-icone" aria-hidden>📚</div>
            <strong className="instalar-titulo">Deixe a Biblioteca no seu celular</strong>
          </>
        )}

        {noIos ? (
          <PassosIos />
        ) : podeInstalarAgora ? (
          <p className="small muted">Abre em tela cheia, como um aplicativo, e funciona sem internet.</p>
        ) : (
          <p className="small muted">Toque no menu ⋮ do navegador e escolha “Instalar aplicativo”.</p>
        )}

        {!noIos && podeInstalarAgora && (
          <button type="button" className="btn-primary instalar-btn-principal" onClick={() => void instalarAgora()}>
            Instalar agora
          </button>
        )}

        {!noIos && (
          <button type="button" className="instalar-dispensar" onClick={dispensar}>
            {podeInstalarAgora ? 'Agora não' : 'Entendi'}
          </button>
        )}
      </div>
    </div>
  );
}
