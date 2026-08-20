# Subir a loja numa VPS, do zero

Runbook da F7. O que este documento assume de você: acesso root/sudo a uma VPS
Linux com a instância Supabase self-hosted JÁ rodando, um domínio apontado para
ela, e cuidado. O que ele NÃO assume: conhecimento prévio deste repositório.

O **porquê** de cada peça está em `docs/producao.md` (topologia na §2, banco na
§3, armadilhas na §5 e §6). Aqui é o **como**, na ordem. Quando um passo puder
falhar em silêncio, o texto diz onde olhar.

**Mapa do caminho:** preparar (§1–§3) → banco (§4–§6) → subir a loja (§7 OU §8)
→ integrações externas (§9) → backup (§10) → conferir (§11).

---

## 1. Pré-requisitos

Na VPS:

- **Supabase self-hosted de pé** (Kong, GoTrue, PostgREST, Postgres). Este
  runbook NÃO sobe o Supabase — a loja usa a instância que já existe.
- **Git** e **Node 22** (`node --version` → v22.x). O Node é necessário mesmo
  no caminho Docker: as migrações e o seed rodam do clone (§6).
- **Escolha UM caminho de execução** e siga só a seção dele:
  - **Docker** (§7): Docker Engine + plugin compose (`docker compose version`).
  - **PM2 + nginx do sistema** (§8): `nginx` instalado e `npm i -g pm2`.
- **certbot** para o TLS (qualquer um dos caminhos): `apt install certbot`.
- **cliente Postgres** para o backup (§10): `apt install postgresql-client`.
- DNS: o domínio da loja (ex.: `loja.exemplo.com.br`) apontando para a VPS.
  O Supabase fica em domínio próprio (ex.: `supabase.exemplo.com.br`) — se ele
  ainda não tem proxy/TLS, o bloco comentado de `deploy/nginx/loja.conf` serve.

## 2. Clonar

```bash
sudo mkdir -p /opt/canastra && sudo chown "$USER" /opt/canastra
git clone <URL-DO-REPO> /opt/canastra
cd /opt/canastra
```

`/opt/canastra` é o caminho usado nos exemplos daqui em diante (e no exemplo de
cron). Se usar outro, troque em todos.

## 3. Variáveis de ambiente — os dois lados

Cada lado tem um `.env.example` **comentado linha a linha**. Ele é a referência;
esta seção só diz o que muda em produção.

### 3.1 Backend (`backend/src/.env`)

```bash
cp backend/src/.env.example backend/src/.env
chmod 600 backend/src/.env    # tem service_role key e tokens de pagamento
```

Edite. Em produção **estes valores mudam em relação ao example**:

| Variável | Valor de produção |
|---|---|
| `NODE_ENV` | `production` — literal. Qualquer outra grafia derruba a subida (é a trava de `ambiente.js`) |
| `DATABASE_URL` | o Postgres da instância Supabase. Docker: `postgres://postgres:SENHA@host.docker.internal:5432/postgres` · PM2: `...@localhost:5432/...` |
| `SUPABASE_URL` | o Kong. Docker: `http://host.docker.internal:8000` · PM2: `http://localhost:8000`. `localhost` aqui é CERTO em produção (§3.1 do producao.md) |
| `SUPABASE_SERVICE_ROLE_KEY` | a `service_role` da instância (docker/.env do stack) |
| `SUPABASE_JWT_SECRET` | o `JWT_SECRET` do docker/.env do stack — **idêntico**. (Instância com chave assimétrica: deixe vazia; o serviço usa o JWKS. §3.1 do producao.md) |
| `CORS_ORIGIN` | `https://loja.exemplo.com.br` (a origem do NAVEGADOR — nunca localhost em produção) |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | do painel do Mercado Pago (§9.1) |
| `WEBHOOK_URL` | `https://loja.exemplo.com.br/api/webhook/mercadopago` |
| `EMAIL_PASS2` | a API key do Resend (§9.2) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | e-mail real + senha gerada (`openssl rand -base64 24`). Guarde a senha: é a conta do painel |
| `LOJA_URL` | `https://loja.exemplo.com.br` |
| `ZIPCODE_ORIGIN`, `MELHOR_ENVIO_TOKEN` | CEP de despacho e token da Melhor Envio |

Sem as obrigatórias a API **recusa subir** e diz quais faltam — isso é desenho,
não defeito (`backend/src/config/ambiente.js`).

### 3.2 Frontend (`NEXT_PUBLIC_*`) — é BUILD-time

**Não existe `.env` de runtime para a vitrine em produção.** Tudo que começa
com `NEXT_PUBLIC_` é assado no bundle na hora do `next build`; mudar depois
exige rebuild. Referência dos nomes: `frontend/.env.example`.

Os valores de produção:

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://supabase.exemplo.com.br` (a origem PÚBLICA do Kong — é o navegador do cliente que a usa) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a `anon key` da instância (pública por definição) |
| `NEXT_PUBLIC_SITE_URL` | `https://loja.exemplo.com.br` |
| `NEXT_PUBLIC_API_URL` | `/api` — mesma origem, prefixo que o nginx remove (§2 do producao.md). No Docker já é o default do build |

Onde declará-las depende do caminho: Docker → `deploy/.env` (§7.1); PM2 →
inline no comando de build (§8.2).

## 4. PostgREST: expor o schema `canastra`

**O erro nº 1 de primeiro deploy** (§3.3 do producao.md): sem isto, TODA rota
da loja responde 404 com o banco perfeitamente migrado.

No `.env` do stack Supabase (ou docker-compose de lá), o serviço `rest`:

```
PGRST_DB_SCHEMAS=public,storage,graphql_public,canastra
```

E reinicie o PostgREST:

```bash
docker compose -f <compose-do-supabase> restart rest
# ou, sem reiniciar: psql -c "NOTIFY pgrst, 'reload config'"
```

## 5. GoTrue: os três ajustes manuais

Nada em código faz isto e nenhum teste alcança — e os três falham **mudos**
(`docs/producao.md` §3.5 explica cada sintoma). No painel do Supabase
(Authentication), com o domínio real da loja:

1. **Allow-list de redirecionamento** (URL Configuration):
   `https://loja.exemplo.com.br/account/verify-email` e
   `https://loja.exemplo.com.br/account/reset-password`. Fora da lista, o link
   do e-mail cai na **home**, sem erro nenhum (§3.5.1).
2. **Modelos de e-mail com `{{ .TokenHash }}`**, não `{{ .ConfirmationURL }}` —
   senão o link falha quando aberto em outro aparelho, que é o caso comum
   (§3.5.2).
3. **SMTP configurado** — sem provedor, cadastro e recuperação de senha param
   com o erro só no log do GoTrue (§3.5.3).

## 6. Banco: migrar e semear

Do clone, com o Node da VPS (o runner usa o driver `pg` do backend):

```bash
cd /opt/canastra
npm --prefix backend ci --omit=dev

# db:migrar NÃO lê .env nenhum — a DATABASE_URL vem do shell, de propósito
# (§5.1 do producao.md). db:seed lê backend/src/.env sozinho.
export DATABASE_URL="postgres://postgres:SENHA@localhost:5432/postgres"

# SÓ NO CAMINHO DOCKER (§7): o backend/src/.env aponta SUPABASE_URL para
# host.docker.internal — que resolve DENTRO do container, não aqui no host,
# onde este seed roda. dotenv nunca sobrepõe o que o shell já definiu, então
# este export vence o .env durante o seed (e só durante ele):
export SUPABASE_URL="http://localhost:8000"

npm run db:setup     # = db:migrar + db:seed, na ordem certa
```

O que esperar: `db:migrar` lista as migrações aplicadas; `db:seed` cria os 29
SKUs e a conta de `SEED_ADMIN_EMAIL` no GoTrue. Os dois são idempotentes —
rodar de novo responde "Nada pendente." e não sobrescreve preço, estoque nem
senha (§3.2 do producao.md). **Se o seed falhar citando SUPABASE_URL ou
SERVICE_ROLE_KEY, ele falhou ALTO de propósito** — corrija o `.env` e rode
`npm run db:seed` de novo.

---

## 7. Caminho A — Docker

Tudo definido em `deploy/docker-compose.prod.yml` (os comentários de lá são
parte da documentação — inclusive as duas formas de alcançar o Supabase da
VPS: `host.docker.internal` ou a rede do compose do Supabase).

### 7.1 As `NEXT_PUBLIC_*` do build

```bash
cd /opt/canastra/deploy
cat > .env <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://supabase.exemplo.com.br
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_SITE_URL=https://loja.exemplo.com.br
EOF
```

(`deploy/.env` alimenta os `build.args` por substituição do compose; não é
runtime. `NEXT_PUBLIC_API_URL=/api` já é o default.)

### 7.2 nginx e TLS

```bash
# Troque loja.exemplo.com.br pelo domínio real (4 ocorrências):
sed -i 's/loja\.exemplo\.com\.br/SEU-DOMINIO/g' nginx/loja.conf
```

O `sed` edita um arquivo **versionado** — o próximo `git pull` vai ver a
modificação local e pode conflitar. Duas saídas: reaplique o sed depois de
cada pull (é idempotente), ou copie o conf para fora do versionamento (ex.:
`deploy/nginx-local/`, que o `.gitignore` não cobre mas o git também não
rastreia) e aponte o volume do serviço `nginx` no compose para lá.

O certificado ainda não existe e o nginx **recusa subir** sem os arquivos que o
conf referencia. Primeira emissão, portanto, antes do `up` completo — com o
serviço nginx servindo só a porta 80, ou com o certbot standalone:

```bash
sudo certbot certonly --standalone -d SEU-DOMINIO   # porta 80 livre nesse momento
```

(Este `--standalone` é SÓ da primeira vez. Com o stack de pé, o §7.4 troca o
método registrado para webroot — **passo obrigatório**, senão a renovação
automática falha em ~60 dias.)

### 7.3 Subir

```bash
cd /opt/canastra/deploy
docker compose -f docker-compose.prod.yml build    # web demora: é o next build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps       # api e web devem ficar "healthy"
docker compose -f docker-compose.prod.yml exec nginx nginx -t
```

Se `api` reiniciar em loop: `docker compose ... logs api` — quase sempre é a
recusa de subida do `ambiente.js` nomeando a variável que falta, ou o banco
inalcançável (confira a opção A/B de rede no cabeçalho do compose).

Se o log do `nginx` disser `host not found in upstream`: `api` ou `web` nunca
ficou saudável (o compose segura o nginx até os dois healthchecks passarem —
esse erro significa que a espera estourou). O problema está no serviço citado,
não no nginx; volte um parágrafo.

Deploy de atualização: `git pull && docker compose -f docker-compose.prod.yml
build && docker compose -f docker-compose.prod.yml up -d` (e `npm run
db:migrar` antes do `up` quando houver migração nova — pode rodar sempre, é
idempotente).

### 7.4 Renovação do TLS: trocar o certbot para webroot (OBRIGATÓRIO)

A primeira emissão (§7.2) usou `--standalone`, que precisa da porta 80 livre —
e o certbot **memoriza o método**: em ~60 dias a renovação automática vai
tentar `--standalone` de novo, achar o nginx na porta 80 e **falhar em
silêncio até o certificado expirar**. Com o stack de pé, troque o método
registrado para webroot (o volume que o compose já monta no nginx):

```bash
sudo certbot certonly --webroot \
  -w /var/lib/docker/volumes/canastra_certbot-webroot/_data \
  -d SEU-DOMINIO \
  --deploy-hook 'docker compose -f /opt/canastra/deploy/docker-compose.prod.yml exec -T nginx nginx -s reload'
```

(Responda "renew" se ele perguntar o que fazer com o certificado existente. O
`--deploy-hook` fica gravado na config de renovação: a cada renovação futura o
nginx recarrega sozinho.) Prove que a renovação funciona **agora**, não em 60
dias:

```bash
sudo certbot renew --dry-run
```

(O `--dry-run` **não executa** deploy-hooks — o `-T` do hook existe porque o
timer do certbot roda sem TTY. Para provar o hook em si, rode uma vez
`sudo certbot renew --dry-run --run-deploy-hooks` ou confira o log da primeira
renovação real.)

## 8. Caminho B — PM2 + nginx do sistema

### 8.1 API

Dependências já instaladas na §6 (`npm --prefix backend ci --omit=dev`).

### 8.2 Vitrine: build standalone

```bash
cd /opt/canastra
npm --prefix frontend ci

NEXT_PUBLIC_SUPABASE_URL=https://supabase.exemplo.com.br \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
NEXT_PUBLIC_SITE_URL=https://loja.exemplo.com.br \
NEXT_PUBLIC_API_URL=/api \
  npm --prefix frontend run build

# O standalone NÃO carrega os estáticos junto (desenho do Next). Sem estas duas
# cópias a loja sobe SEM CSS e sem imagem — de pé e quebrada:
cp -r frontend/.next/static frontend/.next/standalone/.next/static
cp -r frontend/public frontend/.next/standalone/public
```

O build gera `frontend/.next/standalone/server.js` — **direto, sem
subdiretório `frontend/` no meio** (conferido em build real; é efeito do
`outputFileTracingRoot` do `next.config.mjs` apontar para `frontend/`). O
`deploy/ecosystem.config.cjs` já aponta para lá.

Atualizou a loja? `git pull`, refaça build E as duas cópias, `pm2 restart
canastra-web`.

### 8.3 PM2

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 status                    # canastra-api e canastra-web "online"
pm2 save && pm2 startup       # persistir e religar no boot (siga o que ele imprimir)
```

Logs com data em `deploy/logs/` (`pm2 logs canastra-api` também serve).

### 8.4 nginx e TLS

Há um ovo-e-galinha aqui: o `loja.conf` completo referencia certificados que
ainda não existem — e o nginx **recusa carregar** config apontando para
arquivo inexistente. A ordem abaixo resolve: primeiro um server block
temporário só-HTTP (que serve o desafio do certbot), depois o certificado,
só então o conf completo.

**Passo 1 — server block temporário, só porta 80:**

```bash
sudo mkdir -p /var/www/certbot
sudo tee /etc/nginx/conf.d/loja-acme.conf > /dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name SEU-DOMINIO;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
sudo sed -i 's/SEU-DOMINIO/loja.dominio-real.com.br/' /etc/nginx/conf.d/loja-acme.conf
sudo nginx -t && sudo systemctl reload nginx
```

**Passo 2 — emitir o certificado por webroot** (método que fica registrado —
as renovações futuras funcionam com o nginx no ar, sem ovo-e-galinha de novo):

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d SEU-DOMINIO \
  --deploy-hook 'systemctl reload nginx'
sudo certbot renew --dry-run    # prova a renovação AGORA, não em 60 dias
```

**Passo 3 — agora sim, o conf completo** (o 443 já tem certificado para
apontar); o temporário sai, porque o `loja.conf` também atende a porta 80:

```bash
sudo cp deploy/nginx/loja.conf /etc/nginx/conf.d/loja.conf
sudo sed -i 's/loja\.exemplo\.com\.br/SEU-DOMINIO/g' /etc/nginx/conf.d/loja.conf
# Os nomes api/web só existem na rede do compose — aqui é localhost:
sudo sed -i -e 's|http://api:3333|http://127.0.0.1:3333|' \
            -e 's|http://web:3000|http://127.0.0.1:3000|' /etc/nginx/conf.d/loja.conf
sudo rm /etc/nginx/conf.d/loja-acme.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. Integrações externas

### 9.1 Webhook do Mercado Pago

No painel do MP (Suas integrações → sua aplicação → Webhooks), modo produção:

- URL: `https://loja.exemplo.com.br/api/webhook/mercadopago` — **com o
  prefixo `/api`**: é o nginx que o remove antes de entregar ao Express.
- Evento: pagamentos (`payment`).
- Copie a **assinatura secreta** para `MP_WEBHOOK_SECRET` no `backend/src/.env`
  (e reinicie a API). Sem ela o backend **recusa toda notificação** — nenhum
  pedido sai de "pendente", e o log da API diz por quê.

Teste: o próprio painel do MP tem "simular notificação"; a resposta tem de ser
2xx. 401/400 = segredo errado; 404 = o `/api` não está sendo removido (nginx).

### 9.2 Resend (e-mail)

Com a conta do Resend: verifique o domínio de `EMAIL_DOMINIO`
(`cafecanastra.com`) — DNS de DKIM/SPF que o painel deles lista. **Sem domínio
verificado todo envio é recusado**: confirmação de conta, reset de senha e
status de pedido. A API key vai em `EMAIL_PASS2`.

O SMTP do GoTrue (§5.3 daqui / §3.5.3 do producao.md) é configuração SEPARADA,
no painel do Supabase — pode ser o mesmo Resend, mas são dois lugares.

### 9.3 Melhor Envio

Token de produção em `MELHOR_ENVIO_TOKEN`, CEP de despacho em
`ZIPCODE_ORIGIN`. Sem eles a cotação de frete falha — o checkout mostra o
erro, mas teste antes do primeiro cliente (checklist, §11).

## 10. Backup — antes do primeiro cliente, não depois

`docs/producao.md` §5.6: **não existe backup automático nesta instalação.**

```bash
# Guarda a conexão fora do crontab (arquivo só do dono; o próprio
# backup-banco.sh o carrega ao iniciar — o cron não monta ambiente nenhum):
sudo mkdir -p /etc/canastra
sudo install -m 600 -o "$USER" /dev/null /etc/canastra/backup.env
echo 'export DATABASE_URL="postgres://postgres:SENHA@localhost:5432/postgres"' \
  | sudo tee /etc/canastra/backup.env > /dev/null

# Destino dos dumps e log do cron, com o SEU usuário como dono — senão a
# primeira execução agendada morre num "Permission denied" que ninguém vê:
sudo mkdir -p /var/backups/canastra && sudo chown "$USER" /var/backups/canastra
sudo install -m 644 -o "$USER" /dev/null /var/log/canastra-backup.log

# O repositório é editado em Windows, que não guarda bit de execução:
chmod +x /opt/canastra/scripts/backup-banco.sh

# Primeira execução, à mão — o script carrega o backup.env sozinho e VERIFICA
# o dump com pg_restore --list:
/opt/canastra/scripts/backup-banco.sh

# Agendar (diário 03h): a linha pronta está em
# scripts/backup-banco.cron.exemplo — cole com `crontab -e`.
```

Três coisas que o script não faz por você, e o §5.6 exige:

- **cópia para FORA da VPS** — o bloco rclone comentado no fim do script;
- **um ensaio de restauração de verdade** (instruções no topo do script) —
  backup nunca restaurado é backup presumido;
- **cópia do volume do Storage** quando as imagens migrarem para lá (F3).

## 11. Conferir — checklist pós-deploy

Primeiro os itens de banco/instância do `docs/producao.md` §8 ("Depois de
aplicar na VPS, confira à mão"), que valem inteiros. Depois, o que é da loja:

- [ ] `https://loja.exemplo.com.br` carrega com cadeado (TLS ok) e
      `http://` redireciona para `https://`.
- [ ] `https://loja.exemplo.com.br/api/health` responde
      `{"status":"ok","banco":"ok"}` — prova nginx → API → Postgres numa
      requisição só. (`"degradado"` = API de pé, banco não.)
- [ ] A home mostra o catálogo (29 SKUs semeados).
- [ ] Cadastro de ponta a ponta num navegador limpo: formulário → e-mail chega
      → link confirma → conta logada. (Se o link cair na home: §5 daqui,
      allow-list.)
- [ ] Login com a conta de `SEED_ADMIN_EMAIL` entra no painel
      (`/dashboard`).
- [ ] Cotação de frete com um CEP real responde opções no checkout.
- [ ] "Simular notificação" no painel do MP responde 2xx (§9.1).
- [ ] `docker compose ... ps` mostra `api` e `web` **healthy** (ou `pm2 status`
      mostra os dois `online` sem restarts acumulando).
- [ ] O primeiro backup existe no `BACKUP_DIR`, o cron está agendado
      (`crontab -l`) e a cópia externa (rclone) está configurada.
- [ ] Reinicie a VPS uma vez e confira que tudo volta sozinho
      (`restart: unless-stopped` no Docker; `pm2 startup` + `save` no PM2).

Deu algo errado que não está aqui: a tabela sintoma → causa do
`docs/producao.md` §6 é o lugar.
