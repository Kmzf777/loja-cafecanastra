"use client";

import { useState } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import { chamarApi } from "@/lib/painel/transporte";
import {
  RESSALVA_DA_EXPORTACAO,
  avisoDaExportacao,
  consultaDaContagem,
  consultaDaExportacao,
  exportacaoExigeConfirmacao,
  nomeDoArquivoCsv,
  textoDoPeriodo,
} from "@/lib/painel/pedidos/pedidos.logica";

type Contagem = { estado: "contando" } | { estado: "pronta"; linhas: number | null };

/**
 * A EXPORTAÇÃO DO CSV — e as quatro coisas que ela tem de acertar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1. O DOWNLOAD É POR BLOB, E NÃO POR `<a href>`.
 *
 * `GET /admin/orders/export` exige `Authorization: Bearer`. Um `<a href>`
 * aponta o navegador para a URL numa navegação comum, SEM cabeçalho nenhum — a
 * rota responde 401 e o gestor vê uma página de erro em vez de um arquivo, sem
 * nada explicando por quê. Por isso a requisição sai por `chamarApi` (que põe o
 * token) e o corpo vira `Blob`, `URL.createObjectURL` e um `<a download>`
 * sintético.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2. O ARQUIVO NÃO É TOCADO. `res.blob()` entrega os BYTES como vieram: o CSV
 * do backend começa com BOM (`﻿`), separa por `;` e usa vírgula decimal —
 * sem os três, o Excel brasileiro lê UTF-8 como latin-1 ("Piumhi" vira
 * "PiumhÃ­") e joga a linha inteira numa coluna só. Reconstruir o texto aqui
 * (com `res.text()` e um `new Blob([texto])`) é o atalho que perde o BOM sem
 * erro nenhum na tela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 3. SEM PERÍODO, A EXPORTAÇÃO PEDE CONFIRMAÇÃO — e a confirmação DIZ O QUE
 * ESTÁ SENDO ACEITO.
 *
 * Até a Onda 4 este botão baixava a base INTEIRA, com nome, e-mail e CPF de
 * todos os clientes, sem avisar ninguém. Não é hipótese: a memória deste
 * projeto lista CSVs de dados pessoais parados no histórico do Git desta loja.
 * O backend agora recusa sem `confirmar=true`; esta tela desenha a
 * confirmação, com a CONTAGEM real e a frase que nomeia o que vai dentro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 4. ELA DIZ O QUE NÃO LEVA. R27 quer que a exportação espelhe o filtro, e a
 * rota aceita só `de` e `ate` — status, busca e o recorte de NF-e ficam de
 * fora. O período usado é o MESMO do filtro da lista, e o que não vai está
 * escrito na cara do botão (`RESSALVA_DA_EXPORTACAO`).
 */
export function ExportarPedidos({ de, ate }: { de: string; ate: string }) {
  const [aberto, setAberto] = useState(false);
  const [contagem, setContagem] = useState<Contagem>({ estado: "contando" });
  const [aceitou, setAceitou] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const exigeConfirmacao = exportacaoExigeConfirmacao(de, ate);
  const periodo = textoDoPeriodo(de, ate);

  async function abrir() {
    setAberto(true);
    setErro(null);
    setAceitou(false);
    setContagem({ estado: "contando" });

    /*
      A CONTAGEM VEM DA LISTAGEM COM `limit=1`. O que interessa é o `total`, e
      pedir uma linha traz o número sem carregar a base — com CPF dentro — no
      navegador de quem só queria saber o tamanho do arquivo.

      Falhar aqui NÃO impede a exportação: a contagem é informação para decidir,
      não uma cerca. As cercas de verdade (confirmação, teto de linhas, período
      máximo) estão no backend, e valem também para quem chamar a rota por
      `curl`.
    */
    try {
      const res = await chamarApi(consultaDaContagem({ de, ate }));
      if (!res.ok) {
        setContagem({ estado: "pronta", linhas: null });
        return;
      }
      const corpo = (await res.json()) as { total?: number };
      setContagem({
        estado: "pronta",
        linhas: typeof corpo.total === "number" ? corpo.total : null,
      });
    } catch {
      setContagem({ estado: "pronta", linhas: null });
    }
  }

  async function baixar() {
    setBaixando(true);
    setErro(null);
    try {
      const res = await chamarApi(
        consultaDaExportacao({ de, ate, confirmar: exigeConfirmacao }),
      );

      /*
        `res.ok` CONFERIDO ANTES DE QUALQUER COISA. `fetch` não lança em
        4xx/5xx: sem esta guarda, o corpo de erro (`{"error":"O período pedido
        tem 400 dias, acima do máximo de 366."}`) viraria um "pedidos.csv" com
        JSON dentro, e o gestor abriria o Excel para descobrir sozinho. E o
        corpo é lido por `lerCorpo`, nunca por `res.json()` cru — 401 e 403 do
        `isAuthenticated` saem por `sendStatus`, com corpo VAZIO.
      */
      if (!res.ok) {
        setErro(fraseDeErro(res.status, await lerCorpo(res)));
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ancora = document.createElement("a");
      ancora.href = url;
      ancora.download = nomeDoArquivoCsv(de, ate);
      document.body.appendChild(ancora);
      ancora.click();
      ancora.remove();
      URL.revokeObjectURL(url);
      setAberto(false);
    } catch {
      setErro("Não foi possível falar com o servidor da loja. Nada foi baixado.");
    } finally {
      setBaixando(false);
    }
  }

  const linhas = contagem.estado === "pronta" ? contagem.linhas : null;
  const podeBaixar = !baixando && (!exigeConfirmacao || aceitou);

  return (
    <>
      {/* R18 — uma ação primária por página, sempre no mesmo lugar: o canto do
          <Cabecalho>. Ela é `secundaria` porque exportar não é a ação que
          define esta tela (a tela é para despachar pedido), e um botão preto
          sólido no alto disputaria a atenção com a fila de trabalho. */}
      <Botao variante="secundaria" onClick={abrir}>
        Exportar CSV
      </Botao>

      <Dialogo
        aberto={aberto}
        aoMudar={setAberto}
        titulo="Exportar pedidos para o Excel"
        descricao={
          periodo ? (
            <>
              Período <strong>{periodo}</strong> — o mesmo do filtro da lista.
            </>
          ) : (
            <>
              <strong>Sem período</strong>: o arquivo leva a base inteira de
              pedidos, desde o primeiro.
            </>
          )
        }
        acoes={
          <>
            <Botao variante="secundaria" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao onClick={baixar} disabled={!podeBaixar}>
              {/* R14 — sem otimismo: "Baixando…" fica até o servidor responder
                  com o arquivo ou com a recusa. */}
              {baixando ? "Baixando…" : "Baixar CSV"}
            </Botao>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px]">
            {contagem.estado === "contando"
              ? "Contando quantos pedidos entram…"
              : avisoDaExportacao(linhas)}
          </p>

          <p className="text-[12px] text-fuligem-55">{RESSALVA_DA_EXPORTACAO}</p>

          <p className="text-[12px] text-fuligem-55">
            O arquivo abre no Excel em colunas: ele vem com marca de UTF-8,
            separador ponto e vírgula e vírgula decimal.
          </p>

          {/*
            A CAIXA DE ACEITE SÓ APARECE SEM PERÍODO — é o caso em que o arquivo
            carrega os dados pessoais de TODA a base. Com um período escolhido, o
            gestor já delimitou o que está pedindo, e uma caixa a mais viraria
            ritual: quem clica em "aceito" trinta vezes por semana deixa de ler
            o que aceita, e aí ela não protege mais nada.
          */}
          {exigeConfirmacao && (
            <label className="flex items-start gap-2 border-t border-fuligem-20 pt-3 text-[13px]">
              <input
                type="checkbox"
                checked={aceitou}
                onChange={(evento) => setAceitou(evento.target.checked)}
                className={`mt-0.5 size-4 accent-fuligem ${FOCO}`}
              />
              <span>
                Entendo que este arquivo leva{" "}
                <strong>nome, e-mail e CPF de todos os clientes</strong> e que
                sou responsável por onde ele for parar.
              </span>
            </label>
          )}

          {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}

          <p className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
            A exportação fica registrada com o seu usuário.
          </p>
        </div>
      </Dialogo>
    </>
  );
}
