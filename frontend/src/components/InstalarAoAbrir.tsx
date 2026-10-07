import { useEffect, useState } from 'react';
import {
  EVENTO_INSTALAVEL,
  ehAndroid, ehIos, instalar, podeInstalar, rodandoInstalado,
} from '../pwa';

const CHAVE_DISPENSADO = 'pwa-prompt-dispensado-em';
/** Depois de dispensado, só volta a perguntar passado esse tempo. */
const DIAS_ATE_PERGUNTAR_DE_NOVO = 14;

function foiDispensadoRecentemente(): boolean {
  const quando = localStorage.getItem(CHAVE_DISPENSADO);
  if (!quando) return false;
  const dias = (Date.now() - Number(quando)) / (1000 * 60 * 60 * 24);
  return dias < DIAS_ATE_PERGUNTAR_DE_NOVO;
}

/** Ícone de compartilhar do iOS: quadrado com seta para cima. Não existe como glifo Unicode confiável. */
function IconeCompartilharIos() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: '-2px' }}>
      <path d="M12 2v13" />
      <path d="M8 6l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

/**
 * Convite de instalação que aparece sozinho na primeira visita, sem esperar
 * que o usuário navegue até a aba Você.
 *
 * Modal central, não faixa discreta: é a opção que mais converte, e o custo —
 * interromper por um instante — só é pago uma vez, porque dispensar guarda 14
 * dias de silêncio e instalar nunca mostra de novo.
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
    if (foiDispensadoRecentemente()) return;

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
    localStorage.setItem(CHAVE_DISPENSADO, String(Date.now()));
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
        <div className="instalar-icone" aria-hidden>📚</div>
        <strong className="instalar-titulo">Deixe a Biblioteca no seu celular</strong>

        {noIos ? (
          <p className="small muted">
            Toque em <IconeCompartilharIos /> <b>Compartilhar</b>, na barra do Safari, e depois em
            “Adicionar à Tela de Início”.
          </p>
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

        <button type="button" className="instalar-dispensar" onClick={dispensar}>
          {noIos || !podeInstalarAgora ? 'Entendi' : 'Agora não'}
        </button>
      </div>
    </div>
  );
}
