import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { IsbnLookup } from '../api/types';
import { BarcodeNaoEncontrado, lerCodigoDeBarras } from '../lib/barcode';
import { Cover, Spinner } from './ui';

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'camera' }
  | { fase: 'lendo' }
  | { fase: 'consultando'; isbn: string }
  | { fase: 'achou'; livro: IsbnLookup }
  | { fase: 'erro'; mensagem: string; permiteDigitar: boolean };

/**
 * Identifica o livro pelo código de barras da contracapa (EAN-13 = ISBN).
 *
 * Só upload de imagem, sem câmera ao vivo: `getUserMedia` exige HTTPS ou
 * localhost, e o uso natural disto é o celular acessando o servidor por IP da
 * rede em http — onde a câmera fica bloqueada. O seletor de arquivo abre a
 * galeria (e a câmera do sistema, no celular) e funciona em qualquer origem.
 */
export default function EscanearIsbn({ onUsarTermo }: { onUsarTermo: (termo: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' });
  const inputGaleria = useRef<HTMLInputElement>(null);
  const inputCamera = useRef<HTMLInputElement>(null);

  /**
   * Câmera ao vivo exige contexto seguro (https ou localhost). No celular
   * acessando o servidor por IP da rede em http isso não existe — aí usamos o
   * input com capture, que abre a câmera do próprio sistema e funciona igual.
   */
  function temCameraAoVivo(): boolean {
    return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
  }

  async function tirarFoto() {
    if (temCameraAoVivo()) setEstado({ fase: 'camera' });
    else inputCamera.current?.click();
  }

  async function consultar(isbn: string) {
    setEstado({ fase: 'consultando', isbn });
    try {
      setEstado({ fase: 'achou', livro: await api.findByIsbn(isbn) });
    } catch (err) {
      const mensagem = err instanceof ApiError ? err.message : 'Falha ao consultar o ISBN.';
      setEstado({ fase: 'erro', mensagem, permiteDigitar: true });
    }
  }

  async function aoEscolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    setEstado({ fase: 'lendo' });
    try {
      await consultar(await lerCodigoDeBarras(arquivo));
    } catch (err) {
      setEstado({
        fase: 'erro',
        permiteDigitar: true,
        mensagem:
          err instanceof BarcodeNaoEncontrado
            ? 'Não consegui ler o código dessa foto. Tente enquadrar só o código de barras, com boa luz — ou digite os números abaixo dele.'
            : 'Falha ao processar a imagem.',
      });
    }
  }

  function reiniciar() {
    setEstado({ fase: 'ocioso' });
    // Sem limpar o value, escolher o mesmo arquivo de novo não dispara change.
    if (inputGaleria.current) inputGaleria.current.value = '';
    if (inputCamera.current) inputCamera.current.value = '';
  }

  if (!aberto) {
    return (
      <button type="button" className="btn-ghost btn-sm" onClick={() => setAberto(true)}>
        Identificar pelo código de barras
      </button>
    );
  }

  return (
    <div className="card scanner">
      <div className="inline">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Identificar pelo código de barras</h2>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setAberto(false); reiniciar(); }}>
          Fechar
        </button>
      </div>

      <p className="small muted" style={{ margin: '.4rem 0 .8rem' }}>
        Tire uma foto ou envie uma da galeria. O código de barras do livro é o ISBN — com ele a
        edição e a editora vêm exatas, sem precisar escolher na lista.
      </p>

      <div className="scanner-acoes">
        <button type="button" className="btn-ghost btn-sm" onClick={() => inputGaleria.current?.click()}>
          Enviar foto
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={() => void tirarFoto()}>
          Tirar foto
        </button>
      </div>

      {/* Dois inputs escondidos: o nativo é feio e não dá para rotular os dois usos.
          O segundo leva capture="environment", que abre a câmera traseira do
          sistema — funciona em http, ao contrário do getUserMedia. */}
      <input
        ref={inputGaleria}
        type="file"
        accept="image/*"
        className="visualmente-oculto"
        onChange={(e) => void aoEscolherArquivo(e.target.files?.[0])}
        aria-label="Enviar foto do código de barras"
      />
      <input
        ref={inputCamera}
        type="file"
        accept="image/*"
        capture="environment"
        className="visualmente-oculto"
        onChange={(e) => void aoEscolherArquivo(e.target.files?.[0])}
        aria-label="Tirar foto do código de barras"
      />

      {estado.fase === 'camera' && (
        <CameraAoVivo onCapturar={(arquivo) => void aoEscolherArquivo(arquivo)} onCancelar={reiniciar} />
      )}

      {estado.fase === 'lendo' && <Spinner label="Lendo o código de barras..." />}
      {estado.fase === 'consultando' && <Spinner label={`Procurando o ISBN ${estado.isbn}...`} />}

      {estado.fase === 'erro' && (
        <div className="scanner-erro">
          <p className="small" style={{ margin: 0 }}>{estado.mensagem}</p>
          {estado.permiteDigitar && <DigitarIsbn onEnviar={(isbn) => void consultar(isbn)} />}
        </div>
      )}

      {estado.fase === 'achou' && (
        <LivroIdentificado livro={estado.livro} onOutro={reiniciar} onUsarTermo={onUsarTermo} />
      )}
    </div>
  );
}

function LivroIdentificado({
  livro, onOutro, onUsarTermo,
}: { livro: IsbnLookup; onOutro: () => void; onUsarTermo: (termo: string) => void }) {
  const detalhes = [livro.publisher, livro.publishDate, livro.numberOfPages ? `${livro.numberOfPages} págs.` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="scanner-achado">
      <Cover url={livro.coverUrl} title={livro.title} authors={livro.authors} seedKey={livro.isbn} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: '0 0 .1rem', fontSize: '1.05rem' }}>{livro.title}</h3>
        <p className="small muted" style={{ margin: '0 0 .3rem' }}>
          {livro.authors.join(', ') || 'Autor desconhecido'}
        </p>
        <p className="small muted" style={{ margin: '0 0 .6rem' }}>
          {detalhes || 'Sem dados de publicação'} · ISBN {livro.isbn}
        </p>

        <div className="inline" style={{ gap: '.5rem', flexWrap: 'wrap' }}>
          {livro.workKey ? (
            <Link
              className="btn-primary btn-sm"
              to={`/obras/${livro.workKey.replace('/works/', '')}${livro.editionKey ? `?edicao=${livro.editionKey.replace('/books/', '')}` : ''}`}
              style={{ padding: '.35rem .8rem' }}
            >
              Ver e adicionar
            </Link>
          ) : (
            // Sem chave da Open Library não há o que adicionar: o livro veio do
            // Google, que não é a fonte de catálogo do app. Viramos uma busca.
            <button type="button" className="btn-primary btn-sm" onClick={() => onUsarTermo(livro.title)}>
              Procurar no catálogo
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={onOutro}>Ler outro</button>
        </div>

        {livro.fonte === 'google' && (
          <p className="small muted" style={{ margin: '.5rem 0 0' }}>
            Este ISBN não está na Open Library — os dados acima vieram do Google Books e servem para
            você conferir qual edição tem em mãos.
          </p>
        )}
      </div>
    </div>
  );
}

/** Saída universal: o número impresso embaixo do código de barras é o mesmo ISBN. */
function DigitarIsbn({ onEnviar }: { onEnviar: (isbn: string) => void }) {
  const [valor, setValor] = useState('');
  const limpo = valor.replace(/[^0-9Xx]/g, '');
  const podeEnviar = limpo.length === 10 || limpo.length === 13;

  return (
    <form
      className="inline"
      style={{ gap: '.5rem', marginTop: '.6rem' }}
      onSubmit={(e) => { e.preventDefault(); if (podeEnviar) onEnviar(limpo); }}
    >
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="978-85-336-1337-9"
        inputMode="numeric"
        aria-label="Digitar o ISBN"
        style={{ maxWidth: 200 }}
      />
      <button type="submit" className="btn-ghost btn-sm" disabled={!podeEnviar}>Procurar</button>
    </form>
  );
}

/**
 * Câmera ao vivo, usada só onde `getUserMedia` existe (https ou localhost).
 * Prefere a traseira (`facingMode: environment`) porque o código de barras está
 * na contracapa do livro que a pessoa segura à frente.
 */
function CameraAoVivo({
  onCapturar, onCancelar,
}: { onCapturar: (arquivo: File) => void; onCancelar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const encerrar = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let cancelado = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then((s) => {
        if (cancelado) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((err: unknown) => {
        setErro(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Permissão de câmera negada. Libere nas configurações do navegador ou use "Enviar foto".'
            : 'Não consegui abrir a câmera. Use "Enviar foto".',
        );
      });

    // Encerrar a trilha é obrigatório: sem isso a luz da câmera fica acesa.
    return () => { cancelado = true; encerrar(); };
  }, [encerrar]);

  function capturar() {
    const el = video.current;
    if (!el || !el.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext('2d')?.drawImage(el, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      encerrar();
      onCapturar(new File([blob], 'codigo-de-barras.png', { type: 'image/png' }));
    }, 'image/png');
  }

  if (erro) {
    return (
      <div className="scanner-erro">
        <p className="small" style={{ margin: 0 }}>{erro}</p>
        <button type="button" className="btn-ghost btn-sm" style={{ marginTop: '.5rem' }} onClick={onCancelar}>
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="scanner-camera">
      <video ref={video} autoPlay playsInline muted aria-label="Prévia da câmera" />
      <p className="small muted" style={{ margin: '.5rem 0' }}>
        Enquadre só o código de barras da contracapa, com boa luz.
      </p>
      <div className="scanner-acoes">
        <button type="button" className="btn-primary btn-sm" onClick={capturar}>Capturar</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { encerrar(); onCancelar(); }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
