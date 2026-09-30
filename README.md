# 📚 Biblioteca de Leitura

Aplicação full stack para acompanhar a leitura dos livros que **você já possui** — físicos ou
digitais. Não é uma loja e não disponibiliza livros: o app acompanha a leitura, não substitui o livro.

Com ela você pode organizar sua estante, registrar a página atual, guardar anotações e trechos,
pesquisar entre tudo o que escreveu e ver estatísticas de leitura.

## Stack

| Camada   | Tecnologias |
|----------|-------------|
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend  | Node.js, Express 5, TypeScript, Zod |
| Banco    | SQLite (better-sqlite3), schema versionado em SQL |
| Auth     | JWT em cookie `httpOnly` + bcrypt (12 rounds) |
| Catálogo | Open Library Search API |

## Como rodar

```bash
npm run setup   # instala dependências e cria o usuário de demonstração
npm start       # build do frontend + servidor em uma única porta
```

O servidor procura sozinho a **primeira porta livre a partir da 4300** e imprime a URL no terminal.
Para fixar uma porta, defina `PORT` em `backend/.env`.

Modo de desenvolvimento (backend com watch + Vite com HMR):

```bash
npm run dev
```

### Conta de demonstração

O `npm run setup` já cria um usuário pronto para entrar:

| Campo  | Valor |
|--------|-------|
| E-mail | `demo@biblioteca.local` |
| Senha  | `Leitura@2026` |

A conta vem com 4 livros na estante (um em leitura, um pausado, um concluído e um "quero ler"),
histórico de progresso dos últimos dias, 2 anotações e 1 trecho salvo — o suficiente para as
estatísticas e a busca terem conteúdo desde o primeiro acesso. Você também pode criar sua própria
conta em **Criar conta**, na tela de login.

Para trocar esse usuário, edite `SEED_NAME` / `SEED_EMAIL` / `SEED_PASSWORD` em `backend/.env`,
apague `backend/data/biblioteca.db` e rode `npm run seed` de novo.

> São credenciais de um banco SQLite local, criado na sua máquina pelo seed. Não dão acesso a
> nenhum serviço externo.

## PWA e mobile

O app é instalável e funciona offline para leitura. Na barra superior aparece **Instalar** quando o
navegador oferece o convite nativo; no iOS, que não expõe esse evento, o botão explica o caminho
pelo menu Compartilhar.

O que o service worker (`frontend/public/sw.js`) faz, por tipo de pedido:

| Pedido | Estratégia | Por quê |
|--------|-----------|---------|
| navegação | rede primeiro (3,5 s), cai para a casca no cache | sempre pega a versão nova quando há rede |
| `/assets/*` | cache primeiro | nomes com hash, nunca ficam velhos |
| `/api/*` GET | rede primeiro, cai para a última resposta | a estante continua legível sem servidor |
| capas | cache primeiro, teto de 120 | imagem externa é o que mais pesa |
| POST/PATCH/DELETE | **não intercepta** | sem rede, o app mostra erro em vez de fingir que salvou |

Quando uma resposta vem do cache, o service worker marca com `X-Do-Cache` e a interface avisa:
*“Sem contato com o servidor — mostrando os dados salvos no aparelho.”* `navigator.onLine` sozinho
não bastaria: o aparelho pode estar conectado e o servidor, fora do ar.

No logout o cache da API é apagado (`LIMPAR_DADOS`) — outra pessoa pode usar o mesmo aparelho.

**Mobile.** Abaixo de 760 px a navegação vira barra inferior ao alcance do polegar, com alvos de
toque de 48 px; campos usam 16 px para o iOS não dar zoom ao focar; `env(safe-area-inset-*)` cobre
notch e barra de gestos quando o app roda instalado.

**Ícones.** Gerados por `npm run icones` — um script que desenha os pixels e monta o PNG na mão
(zlib do Node, sem nenhuma dependência), nos tamanhos 192/512 comuns e *maskable*, mais o
`apple-touch-icon`.

## Arquitetura

```
Frontend (React)
   ↓  /api/*
Backend (Express)
   ↓  BookService
   ↓  OpenLibraryProvider     ← único ponto que fala HTTP com a Open Library
Open Library API
```

As descrições vindas da Open Library são escritas à mão por colaboradores e chegam com markdown
cru, links de referência, marcadores de nota de rodapé e blocos de metadados de catálogo. A
normalização fica em [`backend/src/lib/text.ts`](backend/src/lib/text.ts) (`cleanDescription`), com
testes caso a caso: remove a atribuição de origem e as URLs preservando o texto dos links, apaga
notas de rodapé (inclusive escapadas), desfaz escapes de markdown, tira a ênfase que viraria
asterisco na tela e corta os metadados após a regra horizontal — só quando já existe sinopse antes
dela, para não descartar descrições curtas. Na tela, a sinopse é quebrada em parágrafos e cortada em
limite de parágrafo, com "Ler mais".

O frontend **nunca** chama a Open Library diretamente. Toda integração externa está isolada em
`backend/src/modules/books/providers/openLibrary.provider.ts`, com cache em memória (TTL de 10 min),
timeout, normalização de resposta e deduplicação de obras repetidas. Trocar de provedor
(Google Books, por exemplo) significa escrever outra classe com a mesma interface.

```
backend/src
├── config/env.ts                    # configuração tipada
├── db/{schema.sql,index.ts,seed.ts} # schema, conexão e dados de demonstração
├── lib/{http,cache,port}.ts         # erros HTTP, cache TTL, descoberta de porta livre
├── middlewares/{auth,error,rateLimit}.ts
└── modules
    ├── auth      # cadastro, login, logout, /me
    ├── books     # BookService + OpenLibraryProvider
    ├── library   # biblioteca, progresso, anotações, trechos
    └── stats     # estatísticas e histórico
```

## Modelo de dados

```
users ──< user_library >── book_editions >── book_works
              │
              ├──< reading_progress   (histórico: um evento por atualização)
              ├──< annotations
              └──< quotes
```

Decisões relevantes:

- **Work × Edition.** `book_works` guarda a obra e `book_editions` cada edição. A mesma obra tem
  várias edições com paginações diferentes — o usuário escolhe a que corresponde ao exemplar dele.
- **Cache, não cópia.** Do catálogo guardamos só o mínimo (chave da Open Library, título, autores,
  capa, páginas). A fonte da verdade continua sendo a Open Library.
- **Total de páginas por exemplar.** `user_library.total_pages` sobrepõe
  `book_editions.number_of_pages`: edições do catálogo frequentemente têm o dado errado ou ausente,
  e é a contagem do exemplar real que define o percentual.
- **Histórico como log.** Cada atualização de progresso grava uma linha em `reading_progress`
  (`page_from → page_to`), o que sustenta as estatísticas de páginas por dia.
- **Isolamento por usuário.** Toda consulta filtra por `user_id`; acessar um item de outro usuário
  devolve 404 (não 403) para não revelar sua existência.
- **Edição manual.** Se o exemplar não está catalogado, o usuário cadastra a edição
  (`book_editions.is_custom = 1`) sem sair do fluxo.

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST   | `/api/auth/register` | cadastro |
| POST   | `/api/auth/login` | login (define cookie `httpOnly`) |
| POST   | `/api/auth/logout` | logout |
| GET    | `/api/auth/me` | usuário da sessão |
| GET    | `/api/books/search?q=&page=&perPage=` | busca obras na Open Library |
| GET    | `/api/books/works/:workId` | detalhes da obra |
| GET    | `/api/books/works/:workId/editions` | edições paginadas |
| GET    | `/api/library` | biblioteca do usuário (filtros `status`, `q`) |
| POST   | `/api/library` | adiciona uma edição à biblioteca |
| GET/PATCH/DELETE | `/api/library/:id` | detalhe, atualização e remoção |
| POST/GET | `/api/library/:id/progress` | registra progresso / histórico |
| GET/POST/PATCH/DELETE | `/api/library/:id/annotations[/:annotationId]` | anotações |
| GET/POST/PATCH/DELETE | `/api/library/:id/quotes[/:quoteId]` | frases e trechos |
| GET    | `/api/library/notes/search?q=` | busca em anotações e trechos |
| GET    | `/api/stats` | estatísticas, sequência de dias e histórico recente |
| GET    | `/api/ai/status` | se a assistência por IA está configurada |
| POST   | `/api/ai/explain` | explica palavra, trecho ou conceito (503 enquanto desligada) |

Todas as rotas, exceto `/api/auth/*` e `/api/health`, exigem sessão.

## Progresso de leitura

Registrar a página é o gesto central do app, então ele aceita as duas formas de contar e ajusta o
resto sozinho:

- **Página absoluta ou percentual.** O percentual só é aceito quando o total de páginas do exemplar
  é conhecido — sem isso não existe conversão honesta.
- **Status acompanha o progresso.** Primeira página registrada → *Lendo*; última página → *Concluído*
  com data de conclusão; correção para trás em um livro concluído → volta para *Lendo*; zerar →
  *Quero ler*. Um livro marcado como *Abandonado* pelo usuário não é reaberto automaticamente.
- **Correções são registradas, não apagadas.** Voltar páginas gera um evento com `pages_read`
  negativo em vez de reescrever o histórico.
- **Atalhos.** `+10 / +25 páginas`, "Terminei o livro" e "Zerar progresso".
- **Ritmo e previsão.** A partir do histórico o app calcula páginas/dia, páginas restantes, dias
  restantes no ritmo atual, data prevista de término e sequência de dias seguidos lendo.

Essas regras vivem em [`backend/src/lib/reading.ts`](backend/src/lib/reading.ts) como funções puras,
sem banco nem HTTP, justamente para serem testáveis caso a caso.

## Testes

```bash
npm --prefix backend test
```

35 testes em `node:test`: regras de progresso e ritmo, limpeza das descrições e um teste de integração que sobe
a aplicação em porta efêmera contra um banco temporário e verifica autenticação, isolamento entre
usuários e o ciclo completo de progresso.

## Segurança

- Senhas com bcrypt (12 rounds); o login compara o hash mesmo quando o e-mail não existe, para não
  vazar quais contas estão cadastradas.
- JWT em cookie `httpOnly`, `sameSite=lax`, expiração de 7 dias.
- Validação de toda entrada com Zod; `x-powered-by` desabilitado; corpo limitado a 256 kB.
- Rate limit em memória nas rotas de autenticação (20/min) e de busca (90/min).

## Assistência por IA (Gemini)

Onde aparece: na aba **Frases e trechos** de cada livro. Ao guardar uma passagem, dá para selecionar
uma palavra ou frase dentro do trecho e pedir a explicação só dela — ou explicar o trecho inteiro. A
resposta pode ser aproveitada como comentário do trecho com um clique. Também está na tela de
**Anotações e trechos**, para explicar um conceito à luz do que você já registrou.

Para ligar:

```bash
npm run ia:chave   # pede a chave, não ecoa na tela, grava em backend/.env com permissão 600
npm start          # reinicia o servidor
```

A chave nunca aparece no terminal, no histórico do shell nem em log, e `backend/.env` está no
`.gitignore`. Também dá para editar o arquivo à mão:

```
AI_PROVIDER=gemini
AI_API_KEY=sua-chave
AI_MODEL=gemini-flash-latest
AI_FALLBACK_MODEL=gemini-flash-lite-latest
```

Os modelos são **aliases** (`-latest`), não versões fixas: o `gemini-2.5-flash` foi aposentado
durante o desenvolvimento deste projeto e um número cravado no código faria o app parar sozinho.

### Como está construída

Sem `AI_API_KEY`, o app continua inteiro: o provider desligado responde 503 com instrução, o
frontend consulta `GET /api/ai/status` e mostra o botão desabilitado em vez de oferecer algo que não
funciona. Nada quebra por falta de chave.

```
POST /api/ai/explain  { mode: 'word' | 'passage' | 'concept', text, context?, libraryItemId? }
```

`AiService` monta o contexto a partir das anotações e trechos **do próprio usuário** naquele livro
(sempre filtrando por `user_id`) e delega a um `AiProvider`. O `GeminiProvider` é o único arquivo
que conhece o formato da API do Google — trocar de modelo ou de fornecedor não sai dali, e a escolha
acontece em `provider.factory.ts` a partir do `.env`.

O prompt instrui o modelo a responder em português, sem markdown, sem resumir a obra e sem spoilers
além do trecho perguntado — o app acompanha a leitura, não a substitui.

Tratamento de falhas, porque a API real oscila: chave recusada, limite de uso, bloqueio de conteúdo
e timeout viram mensagens específicas em vez de um 500 genérico. Sobrecarga (503/429) e timeout são
tratados como transitórios — o pedido é repetido no modelo alternativo antes de desistir, com uma
tentativa por modelo e timeout de 15s, para o leitor não ficar esperando meio minuto por um erro.
A resposta informa qual modelo respondeu e quantos registros do próprio usuário entraram no
contexto.
