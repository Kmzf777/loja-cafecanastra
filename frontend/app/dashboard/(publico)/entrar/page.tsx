import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { destinoDoPainel, lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { ContaSemPermissao } from "./ContaSemPermissao";
import { FormularioDeEntrada } from "./FormularioDeEntrada";

/**
 * A entrada do painel — a porta que faltava.
 *
 * ANTES DISTO, quem tentava abrir o painel sem sessão era mandado para
 * `/account/login`, o login DO CLIENTE: a mesma tela que oferece "criar conta" e
 * fala em pedidos e sacola. O gestor terminava numa loja quando pediu uma
 * ferramenta de trabalho. Agora a porta é própria.
 *
 * ELA FICA FORA DA CERCA POR CONSTRUÇÃO — e o mecanismo MUDOU, então vale
 * dizer qual é hoje. Antes o guard morava na página do catch-all e esta rota
 * escapava por precedência (rota estática vence catch-all opcional); era
 * verdade, mas fazia toda rota futura nascer pública. Agora o guard é o
 * `layout.tsx` do grupo `(protegido)`, e o que mantém esta página livre dele é
 * ela morar no grupo IRMÃO, `(publico)` — layout só envolve quem está dentro.
 * A exceção deixou de ser um efeito colateral do roteador e passou a ser uma
 * pasta com nome, que aparece no diff de quem a criar.
 *
 * E FICA FORA DO GRUPO `(vitrine)`, então não herda cabeçalho, rodapé, banner de
 * cookies nem o provedor da sacola. O que ela precisa herdar é só o RESET: em
 * `app/globals.css` ele é escopado em `.vitrine` (o preflight do Tailwind não é
 * global por causa do painel legado em styled-components). Daí a classe no
 * contêiner abaixo — é o reset e a tipografia da casa, não a moldura da loja.
 */
export const metadata: Metadata = {
  title: "Entrar no painel",
  /**
   * Página de entrada de painel não vai para buscador: ela não tem nada a
   * oferecer a quem pesquisa, e indexada só serviria de alvo. `app/robots.ts` já
   * manda Disallow em `/dashboard`, o que cobre este caminho por prefixo; a meta
   * tag é a segunda camada, para o crawler que ignora robots.txt.
   */
  robots: { index: false, follow: false },
};

const OLHO = "text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55";

export default async function PaginaDeEntradaDoPainel({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `searchParams` é Promise desde o Next 15.
  const params = await searchParams;
  const destino = destinoDoPainel(params.de);
  const acesso = await lerAcessoDoPainel();

  /**
   * Já é gestor: nada de formulário. Pedir a senha de quem acabou de provar
   * quem é seria teatro — e, pior, ensinaria o gestor a digitar a senha do
   * painel sempre que uma tela pedir.
   */
  if (acesso.ehAdmin) redirect(destino);

  // `?aviso=falha` é o recado do guard (ver `decidirAcessoAoPainel`); o segundo
  // termo é o que está acontecendo AGORA, nesta requisição.
  const houveFalha = params.aviso === "falha" || acesso.falhouConsulta;
  const logadoSemSerGestor = acesso.temSessao && !acesso.falhouConsulta;

  return (
    <div className="vitrine flex min-h-screen flex-col bg-cal">
      {/* O acento da marca no topo, e a única cor forte da tela. O resto é
          sóbrio de propósito: isto é ferramenta de trabalho, não vitrine. */}
      <div className="h-1 w-full bg-vermelho" aria-hidden />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center px-4 py-16 md:px-10">
        <p className={OLHO}>Café Canastra · Área de gestão</p>
        <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
          Painel
        </h1>

        {/* A distinção que o gestor precisa fazer: senha errada é uma coisa,
            servidor fora do ar é outra. Sem este aviso ele leria "entre de
            novo", concluiria que errou a senha e trocaria uma senha correta. */}
        {houveFalha ? (
          <p
            role="status"
            className="mt-8 max-w-[62ch] border-l-2 border-alerta bg-cal-puro px-4 py-3 text-[15px] leading-relaxed"
          >
            Não conseguimos confirmar seu acesso agora — foi uma falha nossa de
            sistema, não a sua senha. Tente entrar de novo em instantes; se
            insistir, o banco de dados da loja pode estar fora do ar.
          </p>
        ) : null}

        <div className="mt-10">
          {logadoSemSerGestor ? (
            // Logado como cliente. O e-mail vai junto porque "sem permissão"
            // sem dizer QUAL conta está aberta deixa a pessoa sem saber se
            // errou de conta ou se a conta certa é que não foi liberada. Sem
            // `focarAoMontar`: aqui o bloco já é o conteúdo principal da
            // página, não substituiu nada.
            <ContaSemPermissao email={acesso.email} />
          ) : (
            <FormularioDeEntrada destino={destino} />
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[1440px] px-4 pb-10 md:px-10">
        <p className="text-[14px] text-fuligem-55">
          <Link href="/" className="text-vermelho underline underline-offset-4">
            Voltar para a loja
          </Link>
        </p>
      </footer>
    </div>
  );
}
