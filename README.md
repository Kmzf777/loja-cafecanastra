# Café Canastra — loja

Loja do Café Canastra: vitrine em Next 15, API em Express + PostgreSQL e painel
administrativo. Café de origem única da Serra da Canastra, em Minas Gerais.

> Este repositório nasceu de um fork do **Shopnaw Store** (loja de camisetas) e
> foi convertido. Onde o código ainda fala de camiseta, é herança daquele
> projeto — a conversão é progressiva e está documentada em `docs/`.

---

## Como subir

Precisa de Node 22+ e PostgreSQL 16.

```bash
# 1. dependências
npm --prefix backend install
npm --prefix frontend install

# 2. configuração
cp backend/src/.env.example backend/src/.env

# 3. banco: cria as tabelas e popula o catálogo real
npm run db:setup

# 4. os dois processos, em terminais separados
npm run dev:api    # Express  em :3333
npm run dev:web    # Next     em :3000
```

Entre em <http://localhost:3000>. O painel fica em `/dashboard`, com a conta de
desenvolvimento do `.env.example`.

---

## Verificação

```bash
npm test                    # 52 testes da vitrine (vitest)
npm --prefix backend test   # 15 testes das regras de pagamento (node --test)
npm run verifica            # 37 checagens num Chromium de verdade
```

`npm run verifica` sobe um navegador e percorre o caminho que mais quebra:
guard do painel, login, as 8 rotas administrativas autenticadas, o catálogo na
vitrine, sacola e checkout. Exige os três processos no ar.

---

## Onde fica o quê

```
data/catalogo-canastra.json   catálogo real, com procedência por SKU
                              — fonte única da vitrine E do seed do banco

backend/
  db/schema.sql               DDL completo (idempotente)
  db/seed.js                  popula catálogo, filtros, config e conta inicial
  src/controllers/            pagamento, pedidos, frete, config
  src/repositories/           acesso ao banco
  src/middleware/             autenticação, autorização, upload, validação

frontend/
  app/(vitrine)/              a loja: home, cafés, PDP, sacola, checkout, conta
  app/dashboard/              painel admin (ilha client-only sobre legacy/)
  lib/catalogo/               contrato do catálogo e leitura de preço/estoque
  lib/sacola/                 sacola e checkout
  lib/conta/                  sessão
  legacy/                     código do projeto original, ainda em uso no painel

docs/
  producao.md                 como colocar no ar, e o que está em aberto
  seguranca-dados-pessoais.md dado pessoal removido e o que falta fazer
estetica.md                   direção de arte e design system
```

### As duas metades do catálogo

O catálogo é dividido de propósito:

- **Editorial** — linha, notas, ponto de torra, fotos, textos. Vive em
  `data/catalogo-canastra.json`, versionado e revisado em pull request.
- **Comercial** — preço e estoque. Vive no banco e é editado pelo painel.

A costura é `products.sku`. Mudar o preço no painel muda a vitrine em até um
minuto, sem deploy. Se a API cair, a vitrine continua de pé com o JSON — loja
fechada é pior que preço de ontem, e o checkout reconfere tudo no servidor antes
de cobrar.

---

## Antes de ir para produção

Leia **`docs/producao.md`**. Em resumo:

- Gere `JWT_SECRET` e `JWT_SECRET_REFRESH` novos. Em produção a API **recusa
  subir** com os valores de exemplo — eles estão publicados aqui.
- Troque `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` antes do seed.
- Configure `MP_WEBHOOK_SECRET`: sem ele o webhook é recusado e nenhum pedido
  sai de "pendente".
- Verifique o domínio de e-mail no Resend, senão nenhum e-mail é entregue.
- Resolva o histórico do Git (`docs/seguranca-dados-pessoais.md`).

---

## Stack

**Frontend** Next 15 · React 18 · Tailwind 4 · TypeScript · Vitest
**Backend** Node · Express · PostgreSQL · JWT · bcrypt · Mercado Pago · Melhor Envio · Cloudinary · Resend
