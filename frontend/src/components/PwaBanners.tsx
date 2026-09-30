import { useEffect, useState } from 'react';
import { EVENTO_DADOS_SALVOS } from '../api/client';
import {
  EVENTO_ATUALIZACAO, EVENTO_INSTALAVEL,
  aplicarAtualizacao, ehIos, instalar, podeInstalar, rodandoInstalado,
} from '../pwa';

/** Avisa quando o aparelho perde a conexão. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const entrou = () => setOnline(true);
    const saiu = () => setOnline(false);
    window.addEventListener('online', entrou);
    window.addEventListener('offline', saiu);
    return () => {
      window.removeEventListener('online', entrou);
      window.removeEventListener('offline', saiu);
    };
  }, []);

  return online;
}

/**
 * `navigator.onLine` só sabe do cabo de rede: o aparelho pode estar conectado e
 * o servidor, fora do ar. Este sinal vem do service worker, que avisa quando
 * respondeu do cache.
 */
function useDadosSalvos(): boolean {
  const [salvos, setSalvos] = useState(false);

  useEffect(() => {
    const aviso = (event: Event) => setSalvos((event as CustomEvent<boolean>).detail);
    window.addEventListener(EVENTO_DADOS_SALVOS, aviso);
    return () => window.removeEventListener(EVENTO_DADOS_SALVOS, aviso);
  }, []);

  return salvos;
}

export function OfflineBar() {
  const online = useOnline();
  const dadosSalvos = useDadosSalvos();
  if (online && !dadosSalvos) return null;

  return (
    <div className="pwa-bar pwa-bar-offline" role="status">
      {online
        ? 'Sem contato com o servidor — mostrando os dados salvos no aparelho.'
        : 'Sem conexão — você pode consultar o que já abriu, mas não dá para salvar agora.'}
    </div>
  );
}

export function UpdateBar() {
  const [disponivel, setDisponivel] = useState(false);

  useEffect(() => {
    const aviso = () => setDisponivel(true);
    window.addEventListener(EVENTO_ATUALIZACAO, aviso);
    return () => window.removeEventListener(EVENTO_ATUALIZACAO, aviso);
  }, []);

  if (!disponivel) return null;

  return (
    <div className="pwa-bar pwa-bar-update" role="status">
      <span>Uma versão nova do aplicativo está pronta.</span>
      <button type="button" className="btn-primary btn-sm" onClick={aplicarAtualizacao}>
        Atualizar
      </button>
    </div>
  );
}

/**
 * Botão de instalar. No Chrome/Edge/Android usa o convite nativo; no iOS, que
 * não oferece esse evento, explica o caminho manual — uma vez só.
 */
export function InstallButton() {
  const [disponivel, setDisponivel] = useState(podeInstalar());
  const [dicaIos, setDicaIos] = useState(false);
  const instalado = rodandoInstalado();
  const iosPendente = ehIos() && !instalado && localStorage.getItem('pwa-dica-ios') !== 'vista';

  useEffect(() => {
    const aviso = () => setDisponivel(podeInstalar());
    window.addEventListener(EVENTO_INSTALAVEL, aviso);
    return () => window.removeEventListener(EVENTO_INSTALAVEL, aviso);
  }, []);

  if (instalado) return null;

  if (disponivel) {
    return (
      <button type="button" className="btn-ghost btn-sm" onClick={() => void instalar()}>
        ⤓ Instalar
      </button>
    );
  }

  if (!iosPendente) return null;

  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setDicaIos(true)}>
        ⤓ Instalar
      </button>
      {dicaIos && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            localStorage.setItem('pwa-dica-ios', 'vista');
            setDicaIos(false);
          }}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Instalar no iPhone</h2>
            <p className="small muted">
              O Safari não oferece o botão automático. Para deixar a Biblioteca na tela de início:
            </p>
            <ol className="small" style={{ paddingLeft: '1.2rem', lineHeight: 1.9 }}>
              <li>Toque em <strong>Compartilhar</strong> na barra do Safari.</li>
              <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
              <li>Confirme em <strong>Adicionar</strong>.</li>
            </ol>
            <div className="inline" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  localStorage.setItem('pwa-dica-ios', 'vista');
                  setDicaIos(false);
                }}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
