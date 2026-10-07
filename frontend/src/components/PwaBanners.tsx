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
export function ConviteInstalar() {
  const [disponivel, setDisponivel] = useState(podeInstalar());

  useEffect(() => {
    const aviso = () => setDisponivel(podeInstalar());
    window.addEventListener(EVENTO_INSTALAVEL, aviso);
    return () => window.removeEventListener(EVENTO_INSTALAVEL, aviso);
  }, []);

  if (rodandoInstalado()) return null;

  const noIos = ehIos();
  if (!disponivel && !noIos) return null;

  return (
    <div className="card convite" style={{ marginBottom: '1.5rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '.92rem' }}>Deixe na tela de início</strong>
        <p className="small muted" style={{ margin: '.15rem 0 0' }}>
          {noIos && !disponivel
            ? 'No iPhone: toque em Compartilhar e escolha “Adicionar à Tela de Início”.'
            : 'Abre como aplicativo, em tela cheia, e funciona sem internet.'}
        </p>
      </div>
      {disponivel && (
        <button type="button" className="btn-primary btn-sm" onClick={() => void instalar()}>
          Instalar
        </button>
      )}
    </div>
  );
}
