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
