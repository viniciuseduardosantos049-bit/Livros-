/**
 * Leitura do código de barras (EAN-13) de uma foto da contracapa.
 *
 * Duas estratégias, nesta ordem:
 *  1. `BarcodeDetector` nativo — sem download, quando o navegador tem (Chrome/Android).
 *  2. ZXing, carregado por `import()` dinâmico só quando a 1 falta. Assim quem
 *     nunca escaneia não paga o custo da biblioteca no bundle inicial.
 */

/** Códigos de livro no padrão Bookland; qualquer outro EAN é produto comum. */
function pareceIsbn(codigo: string): boolean {
  const so = codigo.replace(/\D/g, '');
  return so.length === 13 && (so.startsWith('978') || so.startsWith('979'));
}

export class BarcodeNaoEncontrado extends Error {
  constructor() {
    super('Não consegui ler o código de barras dessa foto.');
    this.name = 'BarcodeNaoEncontrado';
  }
}

export async function lerCodigoDeBarras(arquivo: File): Promise<string> {
  const nativo = await tentarNativo(arquivo);
  if (nativo) return nativo;

  const zxing = await tentarZxing(arquivo);
  if (zxing) return zxing;

  throw new BarcodeNaoEncontrado();
}

interface DetectorDeCodigo {
  detect(fonte: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

async function tentarNativo(arquivo: File): Promise<string | null> {
  const Detector = (window as unknown as {
    BarcodeDetector?: {
      new (opcoes?: { formats?: string[] }): DetectorDeCodigo;
      getSupportedFormats(): Promise<string[]>;
    };
  }).BarcodeDetector;
  if (!Detector) return null;

  try {
    const formatos = await Detector.getSupportedFormats();
    if (!formatos.includes('ean_13')) return null;

    const bitmap = await createImageBitmap(arquivo);
    try {
      const codigos = await new Detector({ formats: ['ean_13'] }).detect(bitmap);
      // Uma contracapa pode ter dois códigos (ISBN e preço); ficamos com o de livro.
      return codigos.map((c) => c.rawValue).find(pareceIsbn) ?? null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

async function tentarZxing(arquivo: File): Promise<string | null> {
  const url = URL.createObjectURL(arquivo);
  try {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
    // Foto de celular raramente está perfeitamente enquadrada; vale o custo extra.
    hints.set(DecodeHintType.TRY_HARDER, true);

    const resultado = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
    const texto = resultado.getText();
    return pareceIsbn(texto) ? texto : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Controle devolvido pelo leitor ao vivo, para encerrar a câmera. */
export interface LeituraAoVivo {
  parar(): void;
}

/**
 * Leitura contínua pela câmera.
 *
 * Diferente da foto: em vez de uma imagem única, examina quadro após quadro até
 * um decodificar. Uma foto de celular costuma sair tremida ou em ângulo, e o
 * código de barras só decodifica quando as barras estão nítidas e alinhadas —
 * por isso a tentativa única falha tanto. Varrendo continuamente, basta um
 * quadro bom entre dezenas.
 *
 * Exige contexto seguro (https ou localhost) — em produção isso já vale.
 */
export async function lerAoVivo(
  video: HTMLVideoElement,
  aoEncontrar: (isbn: string) => void,
  aoFalhar: (erro: unknown) => void,
): Promise<LeituraAoVivo> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const leitor = new BrowserMultiFormatReader(hints);
  let encerrado = false;

  const controles = await leitor.decodeFromConstraints(
    // A traseira é a que aponta para o livro; resolução maior ajuda o foco a
    // resolver as barras finas do EAN-13.
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    video,
    (resultado, erro) => {
      if (encerrado) return;
      if (resultado) {
        const texto = resultado.getText();
        // Descarta EAN que não é de livro em vez de encerrar: a contracapa pode
        // ter o código de preço junto, e continuar varrendo acha o certo.
        if (pareceIsbn(texto)) {
          encerrado = true;
          controles.stop();
          aoEncontrar(texto);
        }
        return;
      }
      // Quadro sem código é o caso normal durante a varredura; só erro de
      // dispositivo interessa.
      if (erro && erro.name !== 'NotFoundException') aoFalhar(erro);
    },
  );

  return {
    parar() {
      encerrado = true;
      controles.stop();
    },
  };
}
