import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { limparIsbn, normalizarIsbn } from './isbn.js';

describe('ISBN lido do código de barras', () => {
  it('aceita ISBN-13 válido e devolve como está', () => {
    assert.equal(normalizarIsbn('9788533613379'), '9788533613379');
  });

  it('aceita formatação com hífen e espaço', () => {
    assert.equal(limparIsbn(' 978-85-336-1337-9 '), '9788533613379');
    assert.equal(normalizarIsbn('978-85-336-1337-9'), '9788533613379');
  });

  it('converte ISBN-10 para 13', () => {
    // 0-306-40615-2 é o exemplo canônico da própria norma.
    assert.equal(normalizarIsbn('0306406152'), '9780306406157');
  });

  it('aceita o X como dígito verificador do ISBN-10', () => {
    assert.equal(normalizarIsbn('080442957X'), '9780804429573');
  });

  it('recusa dígito verificador errado', () => {
    // Um dígito trocado na leitura da foto: sem checksum, isso viraria consulta
    // ao livro errado em vez de erro.
    assert.equal(normalizarIsbn('9788533613378'), null);
    assert.equal(normalizarIsbn('0306406153'), null);
  });

  it('recusa EAN-13 que não é livro', () => {
    // Prefixo 789 = produto brasileiro comum; só 978/979 são Bookland.
    assert.equal(normalizarIsbn('7891000100103'), null);
  });

  it('recusa tamanho inválido e lixo', () => {
    for (const entrada of ['', '123', '97885336133791', 'abc', '97885336133']) {
      assert.equal(normalizarIsbn(entrada), null, `deveria recusar ${entrada}`);
    }
  });
});
