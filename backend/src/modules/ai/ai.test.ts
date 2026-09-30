import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPrompt } from './gemini.provider.js';
import { createAiProvider } from './provider.factory.js';

describe('escolha do provider de IA', () => {
  it('fica desligado quando nada está configurado', () => {
    const provider = createAiProvider({ provider: '', apiKey: '', model: 'gemini-flash-latest' });
    assert.equal(provider.enabled, false);
    assert.equal(provider.name, 'disabled');
  });

  it('não liga o Gemini sem chave', () => {
    const provider = createAiProvider({ provider: 'gemini', apiKey: '', model: 'gemini-flash-latest' });
    assert.equal(provider.enabled, false);
  });

  it('liga o Gemini quando há provider e chave', () => {
    const provider = createAiProvider({ provider: 'Gemini', apiKey: 'chave-de-teste', model: 'gemini-flash-latest' });
    assert.equal(provider.name, 'gemini');
    assert.equal(provider.enabled, true);
  });

  it('ignora provider desconhecido em vez de quebrar', () => {
    const provider = createAiProvider({ provider: 'alguma-coisa', apiKey: 'x', model: 'm' });
    assert.equal(provider.enabled, false);
  });
});

describe('prompt enviado ao modelo', () => {
  it('muda a instrução conforme o modo', () => {
    const palavra = buildPrompt({ mode: 'word', text: 'anagnórise' });
    const trecho = buildPrompt({ mode: 'passage', text: 'A dor é inevitável.' });
    assert.match(palavra, /significado desta palavra/i);
    assert.match(trecho, /o que este trecho quer dizer/i);
  });

  it('inclui o livro e o contexto do próprio leitor quando existem', () => {
    const prompt = buildPrompt({
      mode: 'concept',
      text: 'culpa',
      bookTitle: 'Crime e Castigo',
      context: 'Minha anotação sobre Raskólnikov.',
    });
    assert.match(prompt, /Livro: Crime e Castigo/);
    assert.match(prompt, /Minha anotação sobre Raskólnikov/);
  });

  it('não inventa seções de contexto quando não há contexto', () => {
    const prompt = buildPrompt({ mode: 'word', text: 'anagnórise' });
    assert.doesNotMatch(prompt, /Contexto registrado/);
    assert.doesNotMatch(prompt, /Livro:/);
  });

  it('limita o tamanho do contexto enviado', () => {
    const prompt = buildPrompt({ mode: 'concept', text: 'culpa', context: 'x'.repeat(5000) });
    assert.ok(prompt.length < 4000, 'o contexto deve ser truncado antes do envio');
  });
});
