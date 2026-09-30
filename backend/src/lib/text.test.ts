import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanDescription } from './text.js';

describe('limpeza da descrição da Open Library', () => {
  it('remove a atribuição e o link do wikipedia', () => {
    const input =
      'From [wikipedia](https://en.wikipedia.org/wiki/Crime_and_Punishment): Crime and Punishment is a novel by Fyodor Dostoevsky.';
    assert.equal(cleanDescription(input), 'Crime and Punishment is a novel by Fyodor Dostoevsky.');
  });

  it('mantém o texto do link e descarta a URL', () => {
    assert.equal(
      cleanDescription('Publicado em [O Mensageiro Russo](https://exemplo.com/rm) em 1866.'),
      'Publicado em O Mensageiro Russo em 1866.',
    );
  });

  it('remove marcadores de nota de rodapé e definições de referência', () => {
    const input = 'Foi publicado em doze parcelas mensais durante 1866.[1]\n\n[1]: https://exemplo.com/nota';
    assert.equal(cleanDescription(input), 'Foi publicado em doze parcelas mensais durante 1866.');
  });

  it('remove nota de rodapé escrita como link', () => {
    assert.equal(
      cleanDescription('Publicado em doze parcelas durante 1866.[1](https://exemplo.com/nota) Depois saiu em volume único.'),
      'Publicado em doze parcelas durante 1866. Depois saiu em volume único.',
    );
  });

  it('desfaz escapes de markdown preservando colchetes de conteúdo', () => {
    assert.equal(cleanDescription('IPA: \\[prʲɪstʊˈplʲenʲə\\]'), 'IPA: [prʲɪstʊˈplʲenʲə]');
  });

  it('remove marcador de nota de rodapé mesmo escapado', () => {
    assert.equal(
      cleanDescription('É o primeiro grande romance de sua fase madura.\\[2\\]'),
      'É o primeiro grande romance de sua fase madura.',
    );
  });

  it('corta os metadados de catálogo após a regra horizontal', () => {
    const input = [
      'Raskólnikov, um estudante empobrecido de São Petersburgo, planeja matar uma velha agiota para provar uma teoria sobre homens extraordinários.',
      '',
      '----------',
      '**Contains**: Introduction, notes, chronology.',
    ].join('\n');
    assert.equal(
      cleanDescription(input),
      'Raskólnikov, um estudante empobrecido de São Petersburgo, planeja matar uma velha agiota para provar uma teoria sobre homens extraordinários.',
    );
  });

  it('não descarta a sinopse quando a regra horizontal vem logo no início', () => {
    const input = '----------\nUm romance sobre culpa e redenção.';
    assert.equal(cleanDescription(input), 'Um romance sobre culpa e redenção.');
  });

  it('remove ênfase markdown preservando o texto', () => {
    assert.equal(cleanDescription('Um romance **psicológico** sobre a *culpa*.'), 'Um romance psicológico sobre a culpa.');
  });

  it('preserva parágrafos e colapsa linhas em branco extras', () => {
    assert.equal(cleanDescription('Primeiro parágrafo.\n\n\n\nSegundo parágrafo.'), 'Primeiro parágrafo.\n\nSegundo parágrafo.');
  });

  it('devolve null para descrição vazia ou só com resíduo', () => {
    assert.equal(cleanDescription(null), null);
    assert.equal(cleanDescription('   '), null);
    assert.equal(cleanDescription('(https://exemplo.com)'), null);
  });

  it('não estraga texto limpo', () => {
    const limpo = 'Um homem pobre mata uma agiota e enfrenta a própria consciência.';
    assert.equal(cleanDescription(limpo), limpo);
  });
});
