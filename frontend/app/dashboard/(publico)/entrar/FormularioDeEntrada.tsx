"use client";

import { useState } from "react";
import Link from "next/link";
import { Botao } from "@/components/ui/Botao";
import { entrar } from "@/lib/conta/sessao";
import { ContaSemPermissao } from "./ContaSemPermissao";

/**
 * O formulário de entrada do painel.
 *
 * O QUE ELE NÃO FAZ, E ISSO É O PONTO: não traduz erro do GoTrue. `entrar()` de
 * `lib/conta/sessao.ts` já faz isso POR CÓDIGO (`error.code`, nunca pelo texto —
 * o servidor é self-hosted e o texto muda entre versões), e lança `ErroDeLogin`
 * com frase em português. Duplicar a tabela aqui criaria duas verdades sobre a
 * mesma recusa, e a segunda envelheceria calada.
 *
 * NÃO EXISTE LINK DE CRIAR CONTA, e isso é deliberado — não é esquecimento a
 * ser "consertado". Conta de gestor nasce pelo seed do banco ou por
 * `service_role`; `canastra.admins` só é escrita por ela (REVOKE da migração
 * 0003). Um botão de auto-cadastro aqui prometeria um acesso que o banco recusa,
 * e um formulário público de "quero ser administrador" é convite a quem estiver
 * varrendo a internet.
 *
 * `destino` chega já validado pelo servidor (`destinoDoPainel`): só caminho sob
 * `/dashboard` sobrevive à validação, então este componente pode obedecê-lo sem
 * conferir de novo.
 */

const CAMPO =
  "h-12 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

export function FormularioDeEntrada({ destino }: { destino: string }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  /**
   * Entrou, mas a conta não é de gestor. Estado próprio porque NÃO é erro de
   * login: a senha estava certa. Jogar a pessoa para fora aqui a deixaria sem
   * entender o que aconteceu — ela veria a tela de entrada de novo, agora
   * logada, e tentaria a mesma senha outra vez.
   */
  const [entrouSemPermissao, setEntrouSemPermissao] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEntrouSemPermissao(false);
    setEnviando(true);
    try {
      const { usuario } = await entrar(email, senha);

      // O papel vem de `canastra.admins`, lido por `entrar()` — nunca de claim
      // do JWT. Ver o comentário de `lerPapel()` em sessao.ts: a instância do
      // Supabase é compartilhada e `user_metadata` é editável pelo dono da
      // conta, então um "role" no token seria administrador autoatribuído.
      if (usuario.role !== "admin") {
        setEntrouSemPermissao(true);
        setEnviando(false);
        return;
      }

      // Navegação DURA de propósito: /dashboard é uma ilha client-only com
      // roteador próprio, e o guard que decide quem entra roda no servidor —
      // um push do Next não faria nenhum dos dois acontecer.
      window.location.assign(destino);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível entrar.");
      setEnviando(false);
    }
  }

  // `focarAoMontar` porque aqui o bloco SUBSTITUI o formulário: sem mover o
  // foco, ele ficaria no botão "Entrar" que acabou de sair da árvore.
  if (entrouSemPermissao) return <ContaSemPermissao focarAoMontar />;

  return (
    <form onSubmit={aoEnviar} className="max-w-[38ch]">
      <div>
        <label htmlFor="email" className={ROTULO}>
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="senha" className={ROTULO}>
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={`${CAMPO} mt-1.5`}
        />
      </div>

      {/* A frase já vem traduzida de `sessao.ts`. O GoTrue diria "Invalid login
          credentials", em inglês — mensagem de depuração de outra empresa. */}
      {erro ? (
        <p
          role="alert"
          className="mt-5 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
        >
          {erro}
        </p>
      ) : null}

      {/* `aria-busy` no botão e a região viva SEPARADA, e não `aria-live` no
          próprio botão: um elemento que fica `disabled` sai da árvore de
          acessibilidade em vários leitores, então o anúncio que dependesse dele
          simplesmente não sairia — justo no instante em que a pessoa precisa
          saber que algo está acontecendo. A região abaixo é sempre visível ao
          leitor e muda de texto. */}
      <Botao
        type="submit"
        variante="primario"
        disabled={enviando}
        aria-busy={enviando}
        className="mt-7 w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
      >
        {enviando ? "Entrando…" : "Entrar no painel"}
      </Botao>
      <p role="status" className="sr-only">
        {enviando ? "Entrando no painel…" : ""}
      </p>

      <p className="mt-6 text-[14px] text-fuligem-55">
        Esqueceu a senha?{" "}
        <Link
          href="/account/reset-password"
          className="text-vermelho underline underline-offset-4"
        >
          Receber um link para redefinir
        </Link>
        .
      </p>
    </form>
  );
}
