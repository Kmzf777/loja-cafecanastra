# Painel de gestão — Onda 7: o corte

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`.
> **Pré-requisito absoluto:** as Ondas 1 a 6 verdes. Esta onda apaga código; só se apaga o que já
> tem substituto medido.

**Goal:** `frontend/legacy/` deixa de existir, as três dependências que só ele usava saem do
`package.json`, o `globals.css` volta a ser simples, e o CSP fecha.

**Por que o CSP é o prêmio desta onda.** `next.config.mjs:92` carrega `'unsafe-inline'` e
`'unsafe-eval'` — e o comentário de `:22-29` diz por quê: **styled-components**. Enquanto o painel
legado existir, a loja inteira roda com as duas diretivas mais permissivas que um CSP pode ter,
por causa de uma área que só o gestor abre. A reescrita é a única oportunidade de fechar isso, e ela
se perde se o legado ficar meses convivendo.

---

### Task 1: Provar que não sobrou nada de único no legado

**Antes de apagar**, uma varredura que fica no relatório:

- [ ] `grep -rn "from \"@/legacy\|from \"../legacy\|frontend/legacy" frontend --include=*.ts --include=*.tsx --include=*.jsx` — **zero** resultados fora do próprio `legacy/`.
- [ ] Todo teste que vivia em `legacy/` já foi movido: `api.test.ts` → `lib/painel/transporte.test.ts` (Onda 1) e `blingContrato.test.ts` → `lib/painel/bling/contrato.test.ts` (Onda 1). Confirme que os dois estão em `lib/` e verdes.
- [ ] Percorra o **checklist de paridade** de `docs/pesquisa/2026-08-26-riscos-da-reescrita.md` (105 itens) e marque cada um contra a tela nova que o substituiu. Item sem substituto é item que **volta para a Onda 5**, não item que se apaga.

Este passo é o único que não pode ser feito depois. Registre o resultado no corpo do commit.

---

### Task 2: Apagar

- [ ] `git rm -r frontend/legacy`
- [ ] `git rm -r "frontend/app/dashboard/(protegido)/legado"`
- [ ] Remover `styled-components`, `react-router-dom` e `sass` do `frontend/package.json`; rodar `npm --prefix frontend install` para atualizar o lock.
- [ ] `npm --prefix frontend run build` — o build é quem prova que nenhum import ficou pendurado.

> **`react-icons` e `react-input-mask`**: confira antes de remover. Se a vitrine ou o painel novo
> os usarem, ficam. Remova só o que o `grep` provar que ninguém importa.

---

### Task 3: Simplificar o `globals.css`

O arquivo tem quarenta linhas de comentário explicando por que o preflight **não** é global e por
que o scan é restrito com `source(none)`. Com o legado fora, a razão some.

- [ ] O preflight volta a ser global (`@import "tailwindcss/preflight.css"`), e os escopos
      `.vitrine` e `.painel` deixam de precisar do reset manual.
- [ ] **Cuidado:** `.vitrine` e `.painel` carregam mais do que o reset — fonte, entrelinha, tinta,
      densidade de 14px no painel. Isso **fica**. O que sai é só a duplicação do preflight.
- [ ] `@theme static` **não** vira `@theme`. O comentário explica: o tree-shaking do Tailwind faria
      21 das 22 variáveis sumirem do CSS final, e componente que lê `var(--color-*)` em `style={{}}`
      receberia string vazia **sem erro nenhum**. Isso não tem nada a ver com o legado.
- [ ] Reescreva os comentários que ficaram falsos em vez de apagá-los: eles contam a história de por
      que o arquivo foi assim, e essa história é o que impede alguém de refazer a parede.

- [ ] `npm --prefix frontend run test` e `run build` verdes. Confira **visualmente** que a vitrine
      não mudou: o preflight global agora alcança lugares que antes não alcançava.

---

### Task 4: Fechar o CSP

- [ ] Em `next.config.mjs`, remover `'unsafe-inline'` e `'unsafe-eval'` do `script-src`.
- [ ] **O que pode quebrar, e precisa ser testado um por um antes de comemorar:** o SDK do Mercado
      Pago, o GA4/gtag (que só carrega com consentimento), o `next/script` com `strategy`
      `afterInteractive`, e qualquer `style={{}}` inline — este último é `style-src`, não
      `script-src`, e o Next usa `style` inline em `next/image`. **Trate `script-src` e `style-src`
      separadamente**; fechar os dois de uma vez torna impossível saber qual quebrou o quê.
- [ ] O Next precisa de nonce para os próprios scripts inline quando `unsafe-inline` sai. Se a
      configuração de nonce for necessária, ela vem por middleware — e o middleware já existe
      (`frontend/middleware.ts`).
- [ ] Prova: rodar `npm --prefix frontend run build && npm --prefix frontend start` e abrir
      `/`, `/cafes`, `/sacola`, `/checkout` e `/dashboard` com o console aberto. **Zero violação de
      CSP.** Cole a saída no relatório.

> Se o checkout quebrar, **pare e reverta esta task**. Um CSP fechado não vale uma loja que não
> cobra. Registre o que faltou e deixe a task para uma tarefa própria.

---

### Task 5: Limpar o que o legado deixou

- [ ] `frontend/scripts/verifica-fluxo.mjs` visita as rotas antigas e **já estava quebrado antes
      desta reescrita**: a linha 27 espera redirecionamento para `/account/login`, e o guard manda
      para `/dashboard/entrar` desde a reescrita do acesso; e o `executablePath` está cravado num
      caminho Linux que não existe na máquina de desenvolvimento. Ou conserte inteiro, ou apague e
      diga no commit que ele não rodava. **Não deixe um script de fumaça que mente.**
- [ ] O comentário de `Form.jsx` que afirmava que o bug de peso e dimensões "foi corrigido" morre
      com o arquivo — mas a correção real vive no backend desde a leva de defeitos. Confira que ela
      está lá e coberta por teste antes de apagar a fonte da confusão.

---

## Como se sabe que a Onda 7 acabou

1. `frontend/legacy/` não existe. `grep -rn "legacy" frontend --include=*.ts*` só acha menção em
   comentário histórico.
2. `styled-components`, `react-router-dom` e `sass` fora do `package.json`.
3. `npm --prefix frontend run test`, `run build` e `npm --prefix backend test` verdes.
4. `next.config.mjs` sem `'unsafe-eval'` — e sem `'unsafe-inline'` no `script-src`, ou com a razão
   escrita se algo o exigir.
5. As cinco páginas abertas no navegador com **zero violação de CSP** no console.
6. Nenhum item do checklist de paridade sem substituto.
