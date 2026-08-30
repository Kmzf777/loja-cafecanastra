import type { Metadata } from "next";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import {
  ehUltimoAdmin,
  type RespostaDeAdministradores,
} from "@/lib/painel/administradores/administradores.logica";

import { PromoverAdministrador } from "./PromoverAdministrador";
import { TabelaDeAdministradores } from "./TabelaDeAdministradores";

/**
 * `/dashboard/administradores` — a tela que nunca existiu.
 *
 * O QUE ELA CONSERTA. Até a Onda 4 não havia caminho de aplicação NENHUM para
 * criar, listar ou remover administrador: a única escrita em `canastra.admins`
 * do repositório está no script de instalação, e promover um segundo gestor
 * exigia abrir `psql` EM PRODUÇÃO. Some-se a isso que a senha do painel é
 * irrecuperável, e o resultado é um ponto único de falha operacional: uma
 * pessoa esquece a senha e a loja perde a gestão. A política `admins_admin_le`
 * (0006:382) foi criada "porque o painel mostra a lista de administradores" —
 * para uma tela que não existia. Existe agora.
 *
 * SERVER COMPONENT QUE LÊ, ILHAS DE CLIENTE QUE ESCREVEM (spec §2.3). A lista
 * chega renderizada; o JavaScript existe por causa dos dois diálogos.
 *
 * NÃO HÁ FILTRO, BUSCA NEM PAGINAÇÃO, e a ausência é medida: `canastra.admins`
 * tem a ordem de grandeza de uma equipe, não de um catálogo — a loja tem hoje
 * um administrador. R1 e R17 valem para lista de trabalho; uma caixa de busca
 * sobre quatro linhas é um controle que ocupa mais tela do que os dados. A rota
 * `GET /admin/administradores` também não aceita filtro nem página, e desenhar
 * controles que ela não atende seria mentir.
 *
 * ESTA TELA NÃO ESTÁ NO MENU LATERAL — `menu.logica.ts` não tem a entrada, e
 * este bloco não pode editá-la (regra de isolamento da onda). Chega-se aqui por
 * `/dashboard/ajustes`, que a aponta em "Quem administra a loja". Está
 * RELATADO: a entrada devia existir no grupo "Gerir", ao lado de Clientes.
 */
export const metadata: Metadata = {
  title: "Administradores",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

export default async function PaginaDeAdministradores() {
  const [acesso, resposta] = await Promise.all([
    /* A segunda leitura da sessão nesta requisição — a mesma dívida que
       `(protegido)/page.tsx` já registrou. Aqui ela paga um pouco mais do que
       o e-mail do cabeçalho: é dela que sai o `userId` que marca a própria
       linha do gestor com "Você", e sem essa marca a confirmação de remoção
       não teria como avisar que ele está se removendo. */
    lerAcessoDoPainel(),
    lerDaApi<RespostaDeAdministradores>("/admin/administradores"),
  ]);

  const linhas = resposta.ok ? (resposta.dados.data ?? []) : [];

  return (
    <>
      <Cabecalho
        titulo="Administradores"
        descricao="Quem entra no painel e mexe na loja."
        email={acesso.email}
        /* R18 — a ação primária da tela mora sempre no mesmo canto. Ela precisa
           saber quem já é admin para não oferecer quem só produziria um 409. */
        acao={<PromoverAdministrador jaSaoAdmin={linhas.map((l) => l.user_id)} />}
      />

      <div className="mx-auto max-w-[1000px] space-y-4 px-5 py-6">
        {/*
          O AVISO DO ÚLTIMO ADMINISTRADOR, ANTES DE QUALQUER TENTATIVA.

          O trigger `admins_nunca_zero` (0002) impede no banco e o repositório
          traduz o 23001 numa frase decente — mas descobrir a regra pelo erro é
          pior que ser avisado, porque quem clicou em "Remover" já decidiu
          remover. Aqui a informação chega antes do gesto, e diz o conserto
          ("promova outro antes"), não só a proibição.

          `alerta` e não `erro`: um só administrador é um estado FRÁGIL da loja,
          não uma falha. R21 reserva o vermelho a erro e ação destrutiva, e
          pintar de vermelho a configuração normal de uma loja de uma pessoa só
          ensinaria a ignorar vermelho.
        */}
        {resposta.ok && ehUltimoAdmin(linhas) && (
          <Tarja tom="alerta">
            Só uma pessoa administra esta loja. Se ela perder o acesso, ninguém
            abre o painel — e a senha não tem como ser recuperada de dentro.
            Promova um segundo administrador.
          </Tarja>
        )}

        <EstadoDaTela
          /*
            SEMPRE `false` NUM SERVER COMPONENT: quando este JSX existe, o
            `await` já voltou. A prop continua sendo passada, em vez de o
            componente virar três `if`, porque é a ORDEM DAS GUARDAS
            (carregando → erro → vazio → conteúdo) que impede o defeito que ele
            existe para impedir.
          */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /*
            ZERO ADMINISTRADORES É IMPOSSÍVEL no banco (`admins_nunca_zero`), e
            mesmo assim o vazio existe — porque "impossível no banco" e "não
            aconteceu" são coisas diferentes quando a instalação é nova e o seed
            ainda não rodou. O que ele NÃO pode fazer é aparecer por falha de
            rede, e é `resposta.ok` na conta que garante isso.
          */
          vazio={resposta.ok && linhas.length === 0}
          vazioTitulo="Nenhum administrador cadastrado"
          vazioTexto="Isto não deveria acontecer: o banco não deixa a loja ficar sem administrador. Confira se a API está falando com o banco certo."
        >
          <Ficha semPreenchimento>
            {/* A tabela mora num arquivo `"use client"` porque `Coluna.celula` é
                uma FUNÇÃO, e função não atravessa a fronteira Server→Client. O
                porquê inteiro está em `TabelaDeAdministradores.tsx`. */}
            <TabelaDeAdministradores
              linhas={linhas}
              userIdDaSessao={acesso.userId ?? null}
            />
          </Ficha>
        </EstadoDaTela>

        {/*
          O QUE ESTA TELA NÃO FAZ, POR ESCRITO — a doutrina da tela de
          Assinaturas.

          As duas frases respondem às duas perguntas que nascem olhando para a
          tabela, e a segunda evita um erro caro: "Remover" aqui e "Excluir" na
          tela de Clientes parecem a mesma coisa e são opostas. Uma tira o
          crachá; a outra apaga a pessoa, com os pedidos dela.
        */}
        <div className="max-w-[70ch] space-y-2 text-[12px] text-fuligem-55">
          <p>
            Administrador é uma linha em <code>canastra.admins</code>, e não uma
            marca no login: a instância de contas é compartilhada com outros
            projetos, e um token de fora poderia trazer qualquer marca escrita
            nele. Por isso só esta tela promove — nem o próprio gestor consegue
            se promover pelo banco.
          </p>
          <p>
            Remover aqui tira só o acesso ao painel. Para apagar a conta de um
            cliente, com os pedidos e o histórico dele, o caminho é outro e fica
            em Clientes — e esse não tem volta.
          </p>
        </div>
      </div>
    </>
  );
}
