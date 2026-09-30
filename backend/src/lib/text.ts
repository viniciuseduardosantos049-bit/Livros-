/**
 * Normalização de texto vindo da Open Library.
 *
 * As descrições são escritas à mão por colaboradores e chegam com markdown cru,
 * links de referência, marcadores de nota de rodapé e blocos de metadados de
 * catálogo. Nada disso deve vazar para a tela.
 */

/** Regra horizontal markdown: separa a sinopse dos metadados de catálogo. */
const HORIZONTAL_RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/m;

/** Só corta no separador se o que veio antes já é uma sinopse de verdade. */
const MIN_LENGTH_BEFORE_RULE = 120;

export function cleanDescription(input: string | null | undefined): string | null {
  if (!input) return null;

  // Colchetes escapados ("\\[2\\]") precisam virar colchetes antes de procurar
  // notas de rodapé e links, senão o marcador escapa da limpeza.
  let text = input.replace(/\r\n?/g, '\n').replace(/\\([[\]])/g, '$1');

  // 1. Corta os metadados de catálogo que costumam vir após uma regra horizontal.
  const rule = text.match(HORIZONTAL_RULE);
  if (rule?.index !== undefined) {
    const head = text.slice(0, rule.index).trim();
    text = head.length >= MIN_LENGTH_BEFORE_RULE ? head : text.replace(HORIZONTAL_RULE, '');
  }

  text = text
    // 2. Definições de link de referência no rodapé: "[1]: https://..."
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '')
    // 3. Nota de rodapé disfarçada de link: "[1](url)" — o "1" não é conteúdo.
    .replace(/\[\s*\d+\s*\]\((?:[^()]|\([^()]*\))*\)/g, '')
    // 4. Links de referência "[texto][1]" e inline "[texto](url)" viram só o texto.
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    // 5. Marcadores de nota de rodapé soltos: "[1]", "[2]".
    .replace(/\[\d+\]/g, '')
    // 6. URLs cruas que sobraram, dentro ou fora de parênteses.
    .replace(/\((?:\s*https?:\/\/\S+\s*)+\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    // 7. Ênfase markdown — sem renderizador, viraria asterisco na tela.
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    // 8. Escapes de markdown: "\[prʲɪ...\]" precisa virar "[prʲɪ...]".
    .replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, '$1')
    // 9. Atribuição de origem: "From wikipedia:", "Source: ...".
    .replace(/^[ \t]*(?:from|source|fonte)\b[^:\n]{0,40}:[ \t]*/i, '')
    .replace(/^[ \t]*\(\s*source\s*\)[ \t]*/gim, '');

  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    // Sobras de pontuação órfã depois de remover links: "()", "( )", ":".
    .map((line) => (/^[(){}\[\]:;,.\-–—\s]*$/.test(line) ? '' : line))
    .join('\n')
    .replace(/[ \t]*\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > 0 ? text : null;
}
