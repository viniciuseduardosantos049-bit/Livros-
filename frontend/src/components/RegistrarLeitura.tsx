import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { LibraryItem } from '../api/types';
import { Cover, Spinner } from './ui';

/**
 * Folha que sobe de baixo para registrar até onde você leu.
 *
 * É a ação central do aplicativo: acontece toda vez que alguém fecha o livro.
 * Na versão web ela está enterrada dentro do detalhe de cada exemplar; aqui sai
 * do fundo da tela em dois toques.
 *
 * Mostra só os livros em andamento — registrar progresso de algo que você não
 * começou não é um caso real, e listar a estante inteira transformaria dois
 * toques numa rolagem.
 */
export default function RegistrarLeitura({ onFechar }: { onFechar: () => void }) {
  const [itens, setItens] = useState<LibraryItem[] | null>(null);
  const [escolhido, setEscolhido] = useState<LibraryItem | null>(null);
  const [pagina, setPagina] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const fechamento = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (fechamento.current) clearTimeout(fechamento.current); }, []);

  useEffect(() => {
    api
      .listLibrary({ status: 'READING' })
      .then((r) => {
        setItens(r.items);
        // Um livro só em andamento: pula a escolha e já abre no teclado.
        if (r.items.length === 1) selecionar(r.items[0]);
      })
      .catch(() => setErro('Não consegui carregar seus livros.'));
  }, []);

  // Fechar com Esc é o equivalente de teclado ao gesto de arrastar para baixo.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  function selecionar(item: LibraryItem) {
    setEscolhido(item);
    // Pré-preenche com a página atual: quase sempre o novo valor é maior que ela,
    // então o usuário edita em vez de digitar do zero.
    setPagina(String(item.currentPage || ''));
  }

  async function salvar() {
    if (!escolhido) return;

    // Campo vazio precisa ser recusado explicitamente: Number('') é 0, passaria
    // na checagem de finito e salvaria página 0 — o que o servidor interpreta
    // como "voltou à estaca zero" e zera o progresso do livro.
    if (pagina.trim() === '') { setErro('Informe a página.'); return; }

    const numero = Number(pagina);
    if (!Number.isFinite(numero) || numero < 0) { setErro('Informe uma página válida.'); return; }

    // O atributo max do input não impede envio; sem esta checagem, um erro de
    // digitação marcaria o livro como concluído.
    const total = escolhido.totalPages;
    if (total && numero > total) { setErro(`Este exemplar tem ${total} páginas.`); return; }

    setSalvando(true);
    setErro(null);
    try {
      await api.updateProgress(escolhido.id, { currentPage: numero });
      setPronto(true);
      // Fecha sozinha: a confirmação é o próprio sumiço, não mais um toque.
      // Guardado para ser cancelado no desmonte — sem isso, fechar a folha na
      // mão durante a espera dispararia onFechar duas vezes.
      fechamento.current = setTimeout(onFechar, 900);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não consegui salvar.');
      setSalvando(false);
    }
  }

  const totalExibido = escolhido?.totalPages ?? null;
  const percentual = totalExibido && Number(pagina) >= 0
    ? Math.min(100, Math.round((Number(pagina) / totalExibido) * 100))
    : null;

  return (
    <div className="folha-fundo" onClick={onFechar} role="presentation">
      <div
        className="folha"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar leitura"
      >
        <div className="folha-puxador" aria-hidden />

        {pronto ? (
          <div className="folha-pronto">
            <span className="folha-tique" aria-hidden>✓</span>
            <p>Progresso salvo</p>
          </div>
        ) : !escolhido ? (
          <>
            <h2 className="folha-titulo">Até onde você leu?</h2>
            {itens === null && <Spinner label="Carregando..." />}
            {itens?.length === 0 && (
              <p className="muted small">
                Nenhum livro em andamento. Marque um como “lendo” na estante para registrar por aqui.
              </p>
            )}
            <div className="folha-lista">
              {itens?.map((item) => (
                <button key={item.id} type="button" className="folha-livro" onClick={() => selecionar(item)}>
                  <Cover
                    url={item.edition.coverUrl}
                    title={item.work.title}
                    authors={item.work.authors}
                    seedKey={item.work.workKey}
                  />
                  <span className="folha-livro-info">
                    <span className="folha-livro-titulo">{item.work.title}</span>
                    <span className="muted small">
                      pág. {item.currentPage}{item.totalPages ? ` de ${item.totalPages}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="folha-titulo">{escolhido.work.title}</h2>
            <p className="muted small" style={{ margin: '0 0 1.2rem' }}>
              estava na página {escolhido.currentPage}
              {totalExibido ? ` de ${totalExibido}` : ''}
            </p>

            <div className="folha-numero">
              <input
                type="number"
                inputMode="numeric"
                value={pagina}
                onChange={(e) => setPagina(e.target.value)}
                aria-label="Página atual"
                min={0}
                max={totalExibido ?? undefined}
                autoFocus
              />
              {totalExibido && <span className="folha-de">de {totalExibido}</span>}
            </div>

            {percentual !== null && (
              <div className="folha-barra">
                <div style={{ width: `${percentual}%` }} />
                <span className="small muted">{percentual}%</span>
              </div>
            )}

            {erro && <p className="alert alert-error" style={{ marginTop: '1rem' }}>{erro}</p>}

            <div className="folha-acoes">
              {itens && itens.length > 1 && (
                <button type="button" className="btn-ghost" onClick={() => setEscolhido(null)}>
                  Outro livro
                </button>
              )}
              <button type="button" className="btn-primary folha-salvar" onClick={() => void salvar()} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
