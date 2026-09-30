/**
 * Validação de ISBN, pura e sem rede (ver isbn.test.ts).
 *
 * O dígito verificador importa porque a entrada vem de leitura de código de
 * barras numa foto: um dígito lido errado geraria uma consulta que devolve o
 * livro errado em vez de erro. Conferir o checksum transforma isso em "não
 * consegui ler", que é recuperável.
 */

/** Remove hífens, espaços e prefixos como "ISBN". */
export function limparIsbn(bruto: string): string {
  return bruto.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function digitoValidoIsbn10(isbn: string): boolean {
  let soma = 0;
  for (let i = 0; i < 9; i += 1) {
    const d = Number(isbn[i]);
    if (Number.isNaN(d)) return false;
    soma += d * (10 - i);
  }
  const ultimo = isbn[9] === 'X' ? 10 : Number(isbn[9]);
  if (Number.isNaN(ultimo)) return false;
  return (soma + ultimo) % 11 === 0;
}

function digitoValidoIsbn13(isbn: string): boolean {
  let soma = 0;
  for (let i = 0; i < 12; i += 1) {
    const d = Number(isbn[i]);
    if (Number.isNaN(d)) return false;
    soma += d * (i % 2 === 0 ? 1 : 3);
  }
  const verificador = (10 - (soma % 10)) % 10;
  return verificador === Number(isbn[12]);
}

/**
 * Devolve o ISBN normalizado em 13 dígitos, ou null se não for um ISBN válido.
 * Códigos de barras de livro usam os prefixos 978 e 979 (Bookland); qualquer
 * outro EAN-13 lido na foto é produto comum, não livro.
 */
export function normalizarIsbn(bruto: string): string | null {
  const isbn = limparIsbn(bruto);

  if (isbn.length === 10) {
    if (!digitoValidoIsbn10(isbn)) return null;
    return isbn10Para13(isbn);
  }

  if (isbn.length === 13) {
    if (!isbn.startsWith('978') && !isbn.startsWith('979')) return null;
    if (!digitoValidoIsbn13(isbn)) return null;
    return isbn;
  }

  return null;
}

function isbn10Para13(isbn10: string): string {
  const corpo = `978${isbn10.slice(0, 9)}`;
  let soma = 0;
  for (let i = 0; i < 12; i += 1) soma += Number(corpo[i]) * (i % 2 === 0 ? 1 : 3);
  return `${corpo}${(10 - (soma % 10)) % 10}`;
}
