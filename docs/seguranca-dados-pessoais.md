# Dados pessoais no repositório — o que foi removido e o que ainda falta

Data: 2026-08-16

## O que havia

Onze arquivos `.csv` estavam versionados na raiz do repositório. Eram um dump
do banco de produção da loja anterior (**Shopnaw**, de camisetas), de onde este
projeto foi bifurcado. Não eram dados de exemplo:

| Arquivo | Continha |
|---|---|
| `usuarios.csv` | 2 pessoas reais: nome completo, e-mail, telefone e **hash bcrypt da senha** |
| `addresses.csv` | 2 endereços residenciais completos, com rua, número, bairro, cidade e CEP |
| `pedidos.csv` | 3 pedidos com `address_json` — endereço de entrega repetido dentro do JSON |
| `refresh_tokens.csv` | **34 refresh tokens JWT reais**, assinados com o segredo da loja antiga |
| `carts.csv`, `cart_items.csv`, `password_resets.csv`, `promotions.csv`, `product_options.csv`, `produtos.csv`, `store_config.csv` | Dados operacionais da loja antiga, incluindo tokens de redefinição de senha |

Dado pessoal de terceiros num repositório é tratamento de dado sem base legal
(LGPD, art. 7º) e, no caso dos hashes e dos refresh tokens, também é material
diretamente utilizável para ataque.

## O que foi feito

1. Os onze arquivos saíram do controle de versão (`git rm --cached`) e foram
   **apagados do disco**. Numa primeira passada eles tinham sido apenas movidos
   para `.dumps-antigos/`, dentro da própria árvore do projeto — o que resolvia
   o versionamento e não resolvia nada mais: os dados continuavam em texto
   claro dentro de qualquer `tar`, `zip` ou `rsync` do diretório. Dado pessoal
   que não precisa existir não deve ficar guardado "por precaução".
2. `*.csv` e `.dumps-antigos/` entraram no `.gitignore` para o caso não se
   repetir por descuido.
3. O conhecimento que esses arquivos carregavam — a **estrutura** das tabelas —
   foi preservado sem os dados, em `backend/db/schema.sql`, que documenta de
   onde cada coluna veio.

## O que AINDA FALTA — ação de quem administra o repositório

**Remover do diretório de trabalho não apaga do histórico do Git.** Os arquivos
continuam recuperáveis em qualquer commit anterior a esta mudança, e continuam
no GitHub. Para fechar de verdade, é preciso, nesta ordem:

1. **Reescrever o histórico** removendo os arquivos de todos os commits, com
   [`git filter-repo`](https://github.com/newren/git-filter-repo):

   ```bash
   git filter-repo --invert-paths \
     --path usuarios.csv --path addresses.csv --path pedidos.csv \
     --path refresh_tokens.csv --path password_resets.csv --path carts.csv \
     --path cart_items.csv --path promotions.csv --path product_options.csv \
     --path produtos.csv --path store_config.csv
   ```

   Isso reescreve os SHAs: exige `push --force` e que todo mundo com clone
   refaça o clone. Por ser destrutivo e afetar quem mais estiver no repositório,
   **não foi executado automaticamente** — é decisão de quem administra.

2. **Invalidar o que vazou**, porque o histórico ficou público enquanto existiu.
   Enquanto o item 1 não for feito, `git show <commit>:usuarios.csv` continua
   devolvendo os dados hoje, em qualquer clone:
   - Trocar `JWT_SECRET_REFRESH` da loja antiga, se ainda estiver em uso em
     algum ambiente — os 34 tokens do dump foram assinados com ele.
   - Forçar redefinição de senha das duas contas do `usuarios.csv`.
   - Invalidar os tokens de `password_resets.csv`.

3. **Se o repositório já foi público em algum momento**, considerar os dados
   comprometidos e comunicar os titulares, conforme o art. 48 da LGPD.

## Regra daqui pra frente

Dump de banco não entra no repositório. Para reproduzir o ambiente, use
`backend/db/schema.sql` + `backend/db/seed.js`, que criam um banco completo com
o catálogo real do Café Canastra e **nenhum dado pessoal**.
