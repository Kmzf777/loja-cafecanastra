"use strict";

/**
 * As duas funções que tiram a senha do argv do pg_dump (scripts/lib/conexao-pg.sh).
 *
 * POR QUE TEM TESTE: a senha dentro de uma URI é percent-encoded, e libpq a
 * decodifica ao conectar. Mover o valor CRU para PGPASSWORD quebraria em
 * silêncio toda senha com @, / ou % — exatamente os caracteres que obrigam a
 * codificação. E falha silenciosa de backup só aparece no dia do desastre.
 *
 * Roda bash de verdade: Git Bash no Windows, bash do ubuntu-latest no CI.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");

const LIB = path.resolve(__dirname, "../../scripts/lib/conexao-pg.sh");
const SCRIPT = path.resolve(__dirname, "../../scripts/backup-banco.sh");

/**
 * A URI vai como ARGUMENTO ($2), nunca interpolada no texto do script: assim o
 * próprio teste não depende de aspas do shell para valer.
 */
function rodar(funcao, uri) {
  return execFileSync(
    "bash",
    ["-c", `. "$1"; ${funcao} "$2"`, "bash", LIB, uri],
    { encoding: "utf8" },
  );
}

const senha = (uri) => rodar("senha_da_uri", uri);
const semSenha = (uri) => rodar("uri_sem_senha", uri);

test("senha simples", () => {
  assert.equal(
    senha("postgres://postgres:segredo@localhost:5432/postgres"),
    "segredo",
  );
});

test("senha com @ codificado", () => {
  assert.equal(
    senha("postgres://postgres:s%40gredo@localhost:5432/postgres"),
    "s@gredo",
  );
});

test("senha com / codificado", () => {
  assert.equal(senha("postgres://u:a%2Fb@localhost:5432/postgres"), "a/b");
});

test("senha com % codificado", () => {
  assert.equal(senha("postgres://u:a%25b@localhost:5432/postgres"), "a%b");
});

test("senha com barra invertida codificada", () => {
  assert.equal(senha("postgres://u:a%5Cb@localhost:5432/postgres"), "a\\b");
});

test("URI sem senha devolve vazio", () => {
  // Sem o guarda *:* em senha_da_uri, esta URI exportaria o USUÁRIO como senha.
  assert.equal(senha("postgres://postgres@localhost:5432/postgres"), "");
});

test("uri_sem_senha preserva usuário, host, porta e banco", () => {
  assert.equal(
    semSenha("postgres://postgres:segredo@localhost:5432/postgres"),
    "postgres://postgres@localhost:5432/postgres",
  );
});

test("uri_sem_senha preserva a query string", () => {
  assert.equal(
    semSenha("postgres://u:p@host:5432/db?sslmode=require"),
    "postgres://u@host:5432/db?sslmode=require",
  );
});

// URI sem caminho é o caso em que os atalhos plausíveis para achar o sufixo
// (cortar até a primeira barra) não têm barra nenhuma para cortar — e devolvem
// o userinfo, senha inclusive, para dentro da saída.
test("uri_sem_senha em URI sem caminho", () => {
  assert.equal(semSenha("postgres://u:p@host:5432"), "postgres://u@host:5432");
  assert.equal(
    semSenha("postgres://u:p@host:5432?sslmode=require"),
    "postgres://u@host:5432?sslmode=require",
  );
});

test("uri_sem_senha é no-op quando não há senha", () => {
  const uri = "postgres://postgres@localhost:5432/postgres";
  assert.equal(semSenha(uri), uri);
});

// Cada URI vem com o SEU segredo: procurar "segredo" numa URI que nunca o teve
// é uma asserção que passa sozinha. E o segredo da terceira não pode ser "p" —
// !saida.includes("p") reprovaria contra o próprio "postgres".
test("a senha nunca sobra na URI de saída", () => {
  for (const [uri, segredo] of [
    ["postgres://postgres:segredo@localhost:5432/postgres", "segredo"],
    ["postgres://u:s%40gredo@localhost:5432/postgres", "s%40gredo"],
    ["postgres://u:senhaquery@host:5432/db?sslmode=require", "senhaquery"],
  ]) {
    const saida = semSenha(uri);
    assert.ok(!saida.includes(segredo), `sobrou senha em ${saida}`);
    assert.ok(!/:[^@/]*@/.test(saida), `sobrou userinfo com senha em ${saida}`);
  }
});

/**
 * Daqui para baixo: o SCRIPT DE VERDADE, ponta a ponta.
 *
 * POR QUE ISTO EXISTE: os testes acima passam inteiros mesmo que alguém volte a
 * linha do pg_dump para "$DATABASE_URL". Eles provam que a biblioteca sabe
 * tirar a senha; nada provava que o backup a usa — que é o motivo do commit.
 *
 * pg_dump e pg_restore falsos entram no PATH: o de pg_dump anota o argv e o
 * PGPASSWORD que recebeu e cria o arquivo de --file (senão o pg_restore --list
 * e o mv seguintes não teriam o que abrir). Roda em ~1s, sem Postgres nenhum.
 */
function rodarBackup(databaseUrl) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "canastra-backup-"));
  const bin = path.join(base, "bin");
  const destino = path.join(base, "dumps");
  fs.mkdirSync(bin);

  const argvLog = path.join(base, "argv.txt");
  const senhaLog = path.join(base, "pgpassword.txt");

  // Os caminhos vão por AMBIENTE, e não interpolados no texto do shim: assim o
  // teste não depende de escapar caminho de Windows dentro de aspas do shell.
  //
  // mode 0o755 é OBRIGATÓRIO: sem ele o Node cria 0o666 & ~umask, que na CI
  // (umask 022) dá 0644 — e tanto o `command -v` quanto o execve PULAM arquivo
  // sem bit de execução na busca do PATH. O script então ou aborta no próprio
  // `command -v pg_dump`, ou acha o pg_dump REAL do runner e tenta conectar em
  // localhost:5432. Passa no Git Bash de qualquer jeito (Windows não aplica
  // modo), então o defeito só apareceria na CI.
  fs.writeFileSync(
    path.join(bin, "pg_dump"),
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$CANASTRA_TESTE_ARGV"
printf '%s' "\${PGPASSWORD-}" > "$CANASTRA_TESTE_PGPASSWORD"
alvo=""; anterior=""
for a in "$@"; do
  [ "$anterior" = "--file" ] && alvo="$a"
  anterior="$a"
done
[ -n "$alvo" ] && printf 'dump falso' > "$alvo"
exit 0
`,
    { mode: 0o755 },
  );
  // Sai 0: o script roda `pg_restore --list` dentro de um `if !`, então este
  // 0 faz a condição ser falsa e o backup segue. (Comando em condição de `if`
  // fica fora do errexit de qualquer forma — o `set -e` não morde aqui.)
  fs.writeFileSync(
    path.join(bin, "pg_restore"),
    "#!/usr/bin/env bash\nexit 0\n",
    { mode: 0o755 },
  );

  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      DATABASE_URL: databaseUrl,
      BACKUP_DIR: destino,
      CANASTRA_TESTE_ARGV: argvLog,
      CANASTRA_TESTE_PGPASSWORD: senhaLog,
    },
  });

  const ler = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  return {
    status: r.status,
    stderr: r.stderr,
    argv: ler(argvLog),
    pgpassword: ler(senhaLog),
    destino,
    dumps: fs.existsSync(destino)
      ? fs.readdirSync(destino).filter((f) => f.endsWith(".dump"))
      : [],
    limpar: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

test("o script real chama pg_dump com a senha no ambiente e fora do argv", (t) => {
  // Senha com @ e / codificados: se o script passasse o valor cru adiante, a
  // autenticação quebraria — é o caso que obriga a decodificação.
  const r = rodarBackup("postgres://postgres:s%40gr%2Fedo@localhost:5432/postgres");
  t.after(r.limpar);

  assert.equal(r.status, 0, `o script falhou: ${r.stderr}`);
  assert.equal(r.pgpassword, "s@gr/edo", "PGPASSWORD não chegou decodificada");
  assert.ok(!r.argv.includes("s@gr/edo"), `senha no argv: ${r.argv}`);
  assert.ok(!r.argv.includes("s%40gr%2Fedo"), `senha no argv: ${r.argv}`);
  assert.ok(
    r.argv.includes("postgres://postgres@localhost:5432/postgres"),
    `a URI sem senha não chegou ao pg_dump: ${r.argv}`,
  );
  assert.equal(r.dumps.length, 1, "o backup não produziu o .dump verificado");
});

test("senha com / cru aborta em vez de devolver a senha ao argv", (t) => {
  // O parser corta a autoridade no primeiro /, acha uma sem @ e devolve senha
  // vazia. Sem o guarda, a URI INTEIRA — com a senha — iria para o argv.
  const r = rodarBackup("postgres://postgres:s%40gr/edo@localhost:5432/postgres");
  t.after(r.limpar);

  assert.equal(r.status, 1, "deveria abortar");
  assert.match(r.stderr, /não consegui extraí-la/);
  assert.equal(r.argv, null, "pg_dump não podia ter sido chamado");
  assert.equal(r.dumps.length, 0);
});

// Git Bash não aplica modo de arquivo, então este é o único teste da suíte que
// NUNCA roda em Windows — quem o executa é a CI (ubuntu-latest, ci.yml), que é
// também o sistema do alvo real, a VPS. Consequência honesta: em máquina de
// desenvolvimento Windows ele aparece como SKIP, e a primeira execução de
// verdade é a da CI.
//
// As duas asserções não dependem do umask do runner: o script faz `chmod 700`
// na pasta e `chmod 600` no dump DEPOIS de criá-los, então o umask 077 é
// cinto-e-suspensório e o modo final é o do chmod. O & 0o777 tira os bits de
// tipo de arquivo que o st_mode carrega junto.
test("o dump e a pasta nascem 600/700", { skip: process.platform !== "linux" }, (t) => {
  const r = rodarBackup("postgres://postgres:segredo@localhost:5432/postgres");
  t.after(r.limpar);

  assert.equal(r.status, 0, `o script falhou: ${r.stderr}`);
  const modo = (p) => (fs.statSync(p).mode & 0o777).toString(8);
  assert.equal(modo(r.destino), "700");
  assert.equal(modo(path.join(r.destino, r.dumps[0])), "600");
});
