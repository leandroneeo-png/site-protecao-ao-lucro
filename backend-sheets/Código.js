// ==========================================
// CONFIGURAÇÃO DOS BANCOS DE DADOS (IDs)
// ==========================================
const ID_QUEBRAS = "1q5d3jYog8zMnV25IwnE5oNpfjrd5GGFtOT--Z0A3sX0";
const ID_DOCAS = "1U6gyKIW7LwRqFOsIzg09xcEpjuth2byxVATbpw_mwkQ";
const ID_VALIDADE = "1DPoLSVznQzXdpLKxl_a6GbpikFi7SVUC5jU-o7oU-Ro";
const ID_FURTOS = "1pAepZ-vKuC0Y8cgo0ogJWvoMFKBjT8XAU-4-eW_y3eY";
const ID_PRECOS = "1RTmMTqfoxj2svsQKzzv9_WJw0N-9SPJNZ4Dv3wokls4";
const ID_CAIXA = "1w_PQDr5vnf521i4y4onDH4aP10FBFAHAFA6vVVgbxEk";
const ID_INVENTARIO = "11MXWJYO5MkEcCAltYVxhR57sa9XDsOQgguJSuypvjzU";
const ID_TAREFAS = "1ktdRvaMFxakMzpbIaY9hS6yYaq29igXlqFRT_CGJqtw";
const ID_PRODUTOS = "1plGH4vu9L38t8YEQcCH5RAobQqAho5mrSYn1kfsQ450";

// IDs DO SEGMENTO INDÚSTRIA
const ID_IND_REFUGO = "1q9A8QoP9IxrTjiJ1kLKEko5XgQJrls6Y2sLCiF6gye8";
const ID_IND_PARADAS = "1eB52FdzxPsyeUUn2Ec1s63Ns19szHbKhyMD5WOqp1D0";
const ID_IND_QUALIDADE = "1ulfmz9f-v8_p_m7jRN1Y-B7-ss2GQvPbrcipfWBf0kE";
const ID_IND_ALMOXARIFADO = "1rAl8f21RulJkx37v3SoeK07eY3fxzKbzS5s1g9X_pj4";
const ID_IND_INVENTARIO = "1FW-lM4vrFAttA87lZFAPyJeT8BpBB0zqTh4QSMbx6jo";

// Preflight CORS para evitar bloqueios em navegadores restritos
function doOptions(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

// ==========================================
// FUNÇÃO AUXILIAR DE CONVERSÃO DE MOEDA
// ==========================================
function converterMoedaParaFloat(valor) {
  if (valor === null || valor === undefined || valor === "") return 0.0;
  if (typeof valor === "number") return valor;

  let strValor = String(valor).replace(/[R$\s]/gi, '').trim();
  if (strValor === "") return 0.0;

  // Se contiver vírgula, assume que é o separador decimal brasileiro
  if (strValor.indexOf(',') > -1) {
    strValor = strValor.replace(/\./g, '').replace(',', '.');
  }

  let floatValor = parseFloat(strValor);
  return isNaN(floatValor) ? 0.0 : floatValor;
}

// ==========================================
// MÓDULO DE GRAVAÇÃO (RECEBE DO BLOGGER)
// ==========================================
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const tipo = payload.tipo;
    const email = payload.email || "Sem e-mail";
    const empresa = payload.empresa || "Matriz";

    const filial = payload.filial_lancamento || payload.filial || "Loja Padrão";
    const dataHoraFormatada = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy HH:mm:ss");

    // 1. QUEBRAS
    if (tipo === "quebra") {
      const ss = SpreadsheetApp.openById(ID_QUEBRAS);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Mês Ref.", "GTIN", "Descrição", "Quantidade", "Custo (R$)", "Motivo"]);
        sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#0A2540").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.mes, "'" + payload.gtin, payload.descricao, payload.quantidade, converterMoedaParaFloat(payload.custo), payload.motivo]);
    }

    // 2. RECEBIMENTO (DOCAS)
    else if (tipo === "recebimento") {
      const ss = SpreadsheetApp.openById(ID_DOCAS);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Data Entrega", "Fornecedor", "NF-e", "Produto", "Qtd. Divergente", "Custo Unit.", "Motivo", "Observações"]);
        sheet.getRange("A1:L1").setFontWeight("bold").setBackground("#008950").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_entrega, payload.fornecedor, payload.nf, payload.descricao, payload.quantidade, converterMoedaParaFloat(payload.custo), payload.motivo, payload.observacoes || ""]);
    }

    // 3. VALIDADE
    else if (tipo === "validade") {
      const ss = SpreadsheetApp.openById(ID_VALIDADE);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "GTIN", "Produto", "Categoria", "Quantidade", "Custo Unit.", "Data Vencimento"]);
        sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#f97316").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, "'" + payload.gtin, payload.descricao, payload.categoria, payload.quantidade, converterMoedaParaFloat(payload.custo), payload.data_validade]);
    }

    // 4. ATUALIZAR VALIDADE (MODAL AUDITORIA)
    else if (tipo === "atualizar_validade") {
      const ss = SpreadsheetApp.openById(ID_VALIDADE);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() > 0) {
        const data = sheet.getDataRange().getDisplayValues();
        for (let i = data.length - 1; i > 0; i--) {
          const row = data[i];
          let dataStr = String(row[9]).trim();
          let gtinPlanilha = Number(String(row[4]).replace(/[^0-9]/g, ''));
          let gtinSite = Number(String(payload.gtin).replace(/[^0-9]/g, ''));

          if (row[1] === empresa && row[2] === filial && gtinPlanilha === gtinSite && dataStr === String(payload.data_validade).trim()) {
            if (parseFloat(payload.quantidade) <= 0) {
              sheet.deleteRow(i + 1);
            } else {
              sheet.getRange(i + 1, 8).setValue(payload.quantidade);
            }
            break;
          }
        }
      }
    }

    // 4.1 ATUALIZAR REBAIXA (MARCAR COMO REBAIXADO)
    else if (tipo === "atualizar_rebaixa_validade") {
      const ss = SpreadsheetApp.openById(ID_VALIDADE);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() > 0) {
        const data = sheet.getDataRange().getDisplayValues();
        for (let i = data.length - 1; i > 0; i--) {
          const row = data[i];
          let dataStr = String(row[9]).trim();
          let gtinPlanilha = Number(String(row[4]).replace(/[^0-9]/g, ''));
          let gtinSite = Number(String(payload.gtin).replace(/[^0-9]/g, ''));

          if (row[1] === empresa && row[2] === filial && gtinPlanilha === gtinSite && dataStr === String(payload.data_validade).trim()) {
            // Escreve "SIM" ou "NÃO" na Coluna 11 (K)
            sheet.getRange(i + 1, 11).setValue(payload.rebaixado);
            break;
          }
        }
      }
    }

    // 5. FURTOS EVITADOS
    else if (tipo === "furto") {
      const ss = SpreadsheetApp.openById(ID_FURTOS);
      let sheet = ss.getSheets()[0];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora Registro", "Empresa", "Filial", "Usuário", "Data Ocorrência", "Gênero", "Idade", "Abordagem", "Local", "Descrição", "Produto", "Qtd", "Preço Unitário (R$)", "Subtotal (R$)"]);
        sheet.getRange("A1:N1").setFontWeight("bold").setBackground("#dc2626").setFontColor("white");
      }

      const produtos = payload.produtos || [];
      if (produtos.length > 0) {
        produtos.forEach(p => {
          const precoFormatado = converterMoedaParaFloat(p.preco);
          const subtotal = p.qtd * precoFormatado;
          sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_ocorrencia, payload.genero, payload.idade, payload.abordagem, payload.local, payload.descricao, p.nome, p.qtd, precoFormatado, subtotal]);
        });
      } else {
        sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_ocorrencia, payload.genero, payload.idade, payload.abordagem, payload.local, payload.descricao, "Sem produtos", 0, 0, 0]);
      }
    }

    // 6. AUDITORIA DE PREÇO
    else if (tipo === "auditoria_preco") {
      const ss = SpreadsheetApp.openById(ID_PRECOS);
      let sheet = ss.getSheets()[0];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora Registro", "Empresa", "Filial", "Usuário", "Data Auditoria", "GTIN", "Descrição", "Preço Sistema (R$)", "Preço Gôndola (R$)", "Sem Preço"]);
        sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#3b82f6").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_auditoria, "'" + payload.gtin, payload.descricao, converterMoedaParaFloat(payload.preco_sistema), converterMoedaParaFloat(payload.preco_gondola), payload.sem_preco]);
    }

    // 7. CAIXA CENTRAL
    else if (tipo === "caixa_central") {
      const ss = SpreadsheetApp.openById(ID_CAIXA);
      let sheet = ss.getSheets()[0];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora Registro", "Empresa", "Filial", "Usuário", "Data Auditoria", "Operador", "Tipo de Divergência", "Valor Falta (R$)", "Observações"]);
        sheet.getRange("A1:I1").setFontWeight("bold").setBackground("#b91c1c").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_auditoria, payload.operador, payload.tipo_divergencia, converterMoedaParaFloat(payload.valor_falta), payload.observacoes]);
    }

    // 8. INVENTÁRIO ROTATIVO
    else if (tipo === "inventario") {
      const ss = SpreadsheetApp.openById(ID_INVENTARIO);
      let sheet = ss.getSheets()[0];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora Registro", "Empresa", "Filial", "Usuário", "Lote (Corredor)", "GTIN", "Descrição", "Quantidade", "Custo", "Motivo", "ID Inventário", "Status"]);
        sheet.getRange("A1:L1").setFontWeight("bold").setBackground("#10b981").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.lote, "'" + payload.gtin, payload.descricao, payload.quantidade, converterMoedaParaFloat(payload.custo), payload.motivo, payload.id_inventario, payload.status || "ABERTO"]);
    }
    // ==========================================
    // 8.1 ATUALIZAR MOTIVO DO INVENTÁRIO (EDIÇÃO REMOTA)
    // ==========================================
    else if (tipo === "atualizar_motivo_inventario") {
      const ss = SpreadsheetApp.openById(ID_INVENTARIO);
      let sheet = ss.getSheets()[0];

      if (sheet.getLastRow() > 0) {
        const data = sheet.getDataRange().getDisplayValues();
        const cabecalho = data[0];

        const colIdInv = cabecalho.findIndex(h => String(h).toLowerCase().includes("inventario"));
        const colLote = cabecalho.findIndex(h => String(h).toLowerCase().includes("lote"));
        const colGtin = cabecalho.findIndex(h => String(h).toLowerCase().includes("gtin"));
        const colMotivo = cabecalho.findIndex(h => String(h).toLowerCase().includes("motivo"));

        for (let i = 1; i < data.length; i++) {
          let rowIdInv = String(data[i][colIdInv]).trim();
          let rowLote = String(data[i][colLote]).trim();
          let rowGtin = String(data[i][colGtin]).replace(/['" ]/g, '');
          let payGtin = String(payload.gtin).replace(/['" ]/g, '');

          if (rowIdInv === String(payload.id_inventario).trim() && rowLote === String(payload.lote).trim() && rowGtin === payGtin) {
            sheet.getRange(i + 1, colMotivo + 1).setValue(payload.motivo);
            break;
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Motivo atualizado" }));
    }

    // FECHAMENTO DO INVENTÁRIO (COM ZERAMENTO DE NÃO ENCONTRADOS)
    else if (tipo === "fechar_inventario") {
      const ss = SpreadsheetApp.openById(ID_INVENTARIO);
      let sheet = ss.getSheets()[0];
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, "SISTEMA", "FECHAMENTO", "ENCERRAMENTO DE CONTAGEM", 0, 0, "", payload.id_inventario, "FECHADO"]);

      // Varre o array enviado pelo celular e insere 0 na planilha para os produtos não achados
      if (payload.nao_encontrados && payload.nao_encontrados.length > 0) {
        payload.nao_encontrados.forEach(gtin => {
          sheet.appendRow([dataHoraFormatada, empresa, filial, email, "SISTEMA (NÃO ACHOU)", "'" + gtin, "ZERAMENTO AUTOMÁTICO", 0, 0, "Não Identificado", payload.id_inventario, "FECHADO"]);
        });
      }
    }

    // 9. TAREFAS MANUAIS
    else if (tipo === "tarefa") {
      const ss = SpreadsheetApp.openById(ID_TAREFAS);
      let sheet = ss.getSheets()[0];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data Criação", "Empresa", "Filial", "Criado Por", "Título / Demanda", "Prazo Limite", "Status"]);
        sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#f97316").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.titulo, payload.prazo, payload.status]);
    }
    // 10. CONCLUIR TAREFA
    else if (tipo === "concluir_tarefa") {
      const ss = SpreadsheetApp.openById(ID_TAREFAS);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() > 1) {
        const data = sheet.getDataRange().getDisplayValues();
        // Lemos de baixo para cima para pegar a mais recente
        for (let i = data.length - 1; i > 0; i--) {
          const row = data[i];
          // row[1]=Empresa, row[2]=Filial, row[4]=Titulo, row[6]=Status
          if (row[1] === empresa && row[2] === filial && row[4] === payload.titulo && row[6] === "PENDENTE") {
            sheet.getRange(i + 1, 7).setValue("CONCLUÍDA"); // Coluna G
            break;
          }
        }
      }
    }

    // 11. INDÚSTRIA: REFUGO E SUCATA
    else if (tipo === "ind_refugo") {
      const ss = SpreadsheetApp.openById(ID_IND_REFUGO);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Data Refugo", "Turno", "Máquina/Linha", "Material", "Qtd", "Unidade", "Motivo"]);
        sheet.getRange("A1:K1").setFontWeight("bold").setBackground("#0A2540").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_refugo, payload.turno, payload.maquina, payload.material, payload.quantidade, payload.unidade, payload.motivo]);
    }
    // 12. INDÚSTRIA: PARADAS DE MÁQUINA (OEE)
    else if (tipo === "ind_paradas") {
      const ss = SpreadsheetApp.openById(ID_IND_PARADAS);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Data Ocorrência", "Turno", "Máquina/Linha", "Motivo da Parada", "Tempo Perdido (Min)", "Custo da Hora (R$)", "Observações"]);
        sheet.getRange("A1:K1").setFontWeight("bold").setBackground("#dc2626").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_parada, payload.turno, payload.maquina, payload.motivo, payload.tempo, converterMoedaParaFloat(payload.custo_hora), payload.observacoes]);
    }
    // 13. INDÚSTRIA: CONTROLE DE QUALIDADE (RETRABALHO)
    else if (tipo === "ind_qualidade") {
      const ss = SpreadsheetApp.openById(ID_IND_QUALIDADE);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Data Ocorrência", "Turno", "Lote / OP", "Produto", "Motivo Reprovação", "Qtd Reprovada", "Horas Retrabalho", "Custo Hora-Homem (R$)", "Material Extra (R$)"]);
        sheet.getRange("A1:M1").setFontWeight("bold").setBackground("#3b82f6").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_qualidade, payload.turno, payload.lote, payload.produto, payload.motivo, payload.qtd, payload.horas, converterMoedaParaFloat(payload.custo_hora), converterMoedaParaFloat(payload.custo_extra)]);
    }
    // 14. INDÚSTRIA: ALMOXARIFADO / INVENTÁRIO
    else if (tipo === "ind_almoxarifado") {
      const ss = SpreadsheetApp.openById(ID_IND_ALMOXARIFADO);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Data Auditoria", "Turno", "Material / Peça", "Qtd Sistema", "Qtd Física", "Divergência", "Custo Unitário (R$)", "Impacto Financeiro (R$)", "Motivo/Justificativa"]);
        sheet.getRange("A1:M1").setFontWeight("bold").setBackground("#10b981").setFontColor("white");
      }
      sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.data_auditoria, payload.turno, payload.material, payload.qtd_sistema, payload.qtd_fisica, payload.divergencia, converterMoedaParaFloat(payload.custo_unit), converterMoedaParaFloat(payload.impacto), payload.motivo]);
    }
    // 15. INDÚSTRIA: INVENTÁRIO CEGO (BIPAGEM)
    else if (tipo === "ind_inventario" || tipo === "fechar_ind_inventario") {
      const ss = SpreadsheetApp.openById(ID_IND_INVENTARIO);
      let sheet = ss.getSheets()[0];
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Data/Hora", "Empresa", "Filial", "Usuário", "Lote/Corredor", "GTIN", "Descrição", "Quantidade", "ID_Inventario", "Status"]);
        sheet.getRange("A1:J1").setFontWeight("bold").setBackground("#059669").setFontColor("white");
      }
      if (tipo === "fechar_ind_inventario") {
        sheet.appendRow([dataHoraFormatada, empresa, filial, email, "FECHAMENTO", "FECHAMENTO", "Fechamento de Inventário", 0, payload.id_inventario, "FECHADO"]);
      } else {
        sheet.appendRow([dataHoraFormatada, empresa, filial, email, payload.lote, payload.gtin, payload.descricao, payload.quantidade, payload.id_inventario, payload.status]);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ==========================================
// MÓDULO DE LEITURA (ENVIA PARA O BLOGGER)
// ==========================================
function doGet(e) {
  const filial_buscada = String(e.parameter.filial || "").trim();
  const empresa_buscada = String(e.parameter.empresa || "").trim();
  const role = String(e.parameter.role || "").trim();

  let resultados = [];

  const podeVer = (linhaEmpresa, linhaFilial) => {
    if (role === 'admin' || !empresa_buscada) return true; // Libera tudo para o Consultor
    const emp = String(linhaEmpresa).trim();
    const fil = String(linhaFilial).trim();
    return fil === filial_buscada && emp === empresa_buscada;
  };

  // 1. Busca Quebras
  try {
    const sheetQ = SpreadsheetApp.openById(ID_QUEBRAS).getSheets()[0];
    if (sheetQ.getLastRow() > 1) {
      const dataQ = sheetQ.getDataRange().getDisplayValues();
      for (let i = 1; i < dataQ.length; i++) {
        if (podeVer(dataQ[i][1], dataQ[i][2])) {
          resultados.push({ tipo: "quebra", empresa: String(dataQ[i][1]).trim(), usuario: String(dataQ[i][3]).trim(), mes: dataQ[i][4], gtin: dataQ[i][5], descricao: dataQ[i][6], quantidade: dataQ[i][7], custo: dataQ[i][8], motivo: dataQ[i][9], filial: dataQ[i][2] });
        }
      }
    }
  } catch (err) { }

  // 2. Busca Docas
  try {
    const sheetD = SpreadsheetApp.openById(ID_DOCAS).getSheets()[0];
    if (sheetD.getLastRow() > 1) {
      const dataD = sheetD.getDataRange().getDisplayValues();
      for (let i = 1; i < dataD.length; i++) {
        if (podeVer(dataD[i][1], dataD[i][2])) {

          // Lógica de Prevenção: Se a Data da Entrega (coluna 4) estiver em branco, 
          // ele usa a Data/Hora que o sistema gerou no registro da linha (coluna 0).
          const dataCorreta = dataD[i][4] ? dataD[i][4] : dataD[i][0];

          resultados.push({
            tipo: "recebimento",
            empresa: String(dataD[i][1]).trim(),
            usuario: String(dataD[i][3]).trim(),
            data_entrega: dataCorreta,
            fornecedor: dataD[i][5],
            nf: dataD[i][6],
            descricao: dataD[i][7],
            quantidade: dataD[i][8],
            custo: dataD[i][9],
            motivo: dataD[i][10],
            filial: dataD[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 3. Busca Validades
  try {
    const sheetV = SpreadsheetApp.openById(ID_VALIDADE).getSheets()[0];
    if (sheetV.getLastRow() > 1) {
      const dataV = sheetV.getDataRange().getDisplayValues();
      for (let i = 1; i < dataV.length; i++) {
        if (podeVer(dataV[i][1], dataV[i][2])) {
          resultados.push({
            tipo: "validade", empresa: String(dataV[i][1]).trim(), usuario: String(dataV[i][3]).trim(), gtin: String(dataV[i][4]).replace(/[^0-9]/g, ''),
            descricao: dataV[i][5], categoria: dataV[i][6], quantidade: dataV[i][7],
            custo: dataV[i][8], data_validade: dataV[i][9], rebaixado: dataV[i][10] || "NÃO", filial: dataV[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 4. Busca Furtos
  try {
    const sheetF = SpreadsheetApp.openById(ID_FURTOS).getSheets()[0];
    if (sheetF.getLastRow() > 1) {
      const dataF = sheetF.getDataRange().getDisplayValues();
      for (let i = 1; i < dataF.length; i++) {
        if (podeVer(dataF[i][1], dataF[i][2])) {
          resultados.push({
            tipo: "furto", empresa: String(dataF[i][1]).trim(), usuario: String(dataF[i][3]).trim(), data_hora_registro: dataF[i][0], data_ocorrencia: dataF[i][4], genero: dataF[i][5],
            idade: dataF[i][6], abordagem: dataF[i][7], local: dataF[i][8], descricao: dataF[i][9],
            produto: dataF[i][10], quantidade: dataF[i][11], preco: dataF[i][12], subtotal: dataF[i][13], filial: dataF[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 5. Busca Auditoria de Preços
  try {
    const sheetP = SpreadsheetApp.openById(ID_PRECOS).getSheets()[0];
    if (sheetP.getLastRow() > 1) {
      const dataP = sheetP.getDataRange().getDisplayValues();
      for (let i = 1; i < dataP.length; i++) {
        if (podeVer(dataP[i][1], dataP[i][2])) {
          resultados.push({
            tipo: "auditoria_preco", empresa: String(dataP[i][1]).trim(), usuario: String(dataP[i][3]).trim(), data_auditoria: dataP[i][4], gtin: String(dataP[i][5]).replace(/[^0-9]/g, ''),
            descricao: dataP[i][6], preco_sistema: dataP[i][7], preco_gondola: dataP[i][8], sem_preco: dataP[i][9], filial: dataP[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 6. Busca Caixa Central
  try {
    const sheetC = SpreadsheetApp.openById(ID_CAIXA).getSheets()[0];
    if (sheetC.getLastRow() > 1) {
      const dataC = sheetC.getDataRange().getDisplayValues();
      for (let i = 1; i < dataC.length; i++) {
        if (podeVer(dataC[i][1], dataC[i][2])) {
          resultados.push({
            tipo: "caixa_central", empresa: String(dataC[i][1]).trim(), usuario: String(dataC[i][3]).trim(), data_auditoria: dataC[i][4], operador: dataC[i][5], tipo_divergencia: dataC[i][6],
            valor_falta: dataC[i][7], observacoes: dataC[i][8], filial: dataC[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 7. Busca Inventário
  try {
    const sheetI = SpreadsheetApp.openById(ID_INVENTARIO).getSheets()[0];
    if (sheetI.getLastRow() > 1) {
      const dataI = sheetI.getDataRange().getDisplayValues();
      for (let i = 1; i < dataI.length; i++) {
        if (podeVer(dataI[i][1], dataI[i][2])) {
          let gtinOriginal = String(dataI[i][5]).trim();
          let gtinProcessado = (gtinOriginal === 'FECHAMENTO' || gtinOriginal === 'LISTA_DIRIGIDA')
            ? gtinOriginal
            : gtinOriginal.replace(/[^0-9]/g, '');

          resultados.push({
            tipo: "inventario", empresa: String(dataI[i][1]).trim(), usuario: String(dataI[i][3]).trim(), data_registro: dataI[i][0], lote: dataI[i][4],
            gtin: gtinProcessado, descricao: dataI[i][6],
            quantidade: dataI[i][7], custo: converterMoedaParaFloat(dataI[i][8]),
            motivo: dataI[i][9], id_inventario: dataI[i][10], status: dataI[i][11], filial: dataI[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 8. Busca Tarefas
  try {
    const sheetT = SpreadsheetApp.openById(ID_TAREFAS).getSheets()[0];
    if (sheetT.getLastRow() > 1) {
      const dataT = sheetT.getDataRange().getDisplayValues();
      for (let i = 1; i < dataT.length; i++) {
        if (podeVer(dataT[i][1], dataT[i][2])) {
          resultados.push({
            tipo: "tarefa", empresa: String(dataT[i][1]).trim(), usuario: String(dataT[i][3]).trim(), titulo: dataT[i][4], prazo: dataT[i][5], status: dataT[i][6], filial: dataT[i][2]
          });
        }
      }
    }
  } catch (err) { }

  // 9. Busca Cadastro de Produtos (Master Data)
  try {
    const sheetProd = SpreadsheetApp.openById(ID_PRODUTOS).getSheets()[0];
    if (sheetProd.getLastRow() > 1) {
      const dataProd = sheetProd.getDataRange().getDisplayValues();
      for (let i = 1; i < dataProd.length; i++) {

        // Verifica se a Empresa bate (Coluna A)
        if (String(dataProd[i][0]).trim() === empresa_buscada) {
          resultados.push({
            tipo: "produto",
            filial: String(dataProd[i][1]).trim(),               // <--- ADICIONADO: O robô agora lê a Coluna B (Filial)
            gtin: String(dataProd[i][2]).replace(/[^0-9]/g, ''), // Coluna C [2] - GTIN
            descricao: dataProd[i][3],                           // Coluna D [3] - Descrição
            custo: dataProd[i][4],                               // Coluna E [4] - Custo
            preco: dataProd[i][5]                                // Coluna F [5] - Preço
          });
        }

      }
    }
  } catch (err) { }

  // 10. Busca Refugo Industrial
  try {
    const sheetIR = SpreadsheetApp.openById(ID_IND_REFUGO).getSheets()[0];
    if (sheetIR.getLastRow() > 1) {
      const dataIR = sheetIR.getDataRange().getDisplayValues();
      for (let i = 1; i < dataIR.length; i++) {
        if (podeVer(dataIR[i][1], dataIR[i][2])) {
          resultados.push({ tipo: "ind_refugo", empresa: String(dataIR[i][1]).trim(), usuario: String(dataIR[i][3]).trim(), data_refugo: dataIR[i][4], turno: dataIR[i][5], maquina: dataIR[i][6], material: dataIR[i][7], quantidade: dataIR[i][8], unidade: dataIR[i][9], motivo: dataIR[i][10], filial: dataIR[i][2] });
        }
      }
    }
  } catch (err) { }
  // 11. Busca Paradas de Máquina
  try {
    const sheetIP = SpreadsheetApp.openById(ID_IND_PARADAS).getSheets()[0];
    if (sheetIP.getLastRow() > 1) {
      const dataIP = sheetIP.getDataRange().getDisplayValues();
      for (let i = 1; i < dataIP.length; i++) {
        if (podeVer(dataIP[i][1], dataIP[i][2])) {
          resultados.push({ tipo: "ind_paradas", empresa: String(dataIP[i][1]).trim(), usuario: String(dataIP[i][3]).trim(), data_parada: dataIP[i][4], turno: dataIP[i][5], maquina: dataIP[i][6], motivo: dataIP[i][7], tempo: dataIP[i][8], custo_hora: dataIP[i][9], observacoes: dataIP[i][10], filial: dataIP[i][2] });
        }
      }
    }
  } catch (err) { }
  // 12. Busca Qualidade (Retrabalho)
  try {
    const sheetIQ = SpreadsheetApp.openById(ID_IND_QUALIDADE).getSheets()[0];
    if (sheetIQ.getLastRow() > 1) {
      const dataIQ = sheetIQ.getDataRange().getDisplayValues();
      for (let i = 1; i < dataIQ.length; i++) {
        if (podeVer(dataIQ[i][1], dataIQ[i][2])) {
          resultados.push({ tipo: "ind_qualidade", empresa: String(dataIQ[i][1]).trim(), usuario: String(dataIQ[i][3]).trim(), data_qualidade: dataIQ[i][4], turno: dataIQ[i][5], lote: dataIQ[i][6], produto: dataIQ[i][7], motivo: dataIQ[i][8], qtd: dataIQ[i][9], horas: dataIQ[i][10], custo_hora: dataIQ[i][11], custo_extra: dataIQ[i][12], filial: dataIQ[i][2] });
        }
      }
    }
  } catch (err) { }
  // 13. Busca Almoxarifado / Inventário
  try {
    const sheetIA = SpreadsheetApp.openById(ID_IND_ALMOXARIFADO).getSheets()[0];
    if (sheetIA.getLastRow() > 1) {
      const dataIA = sheetIA.getDataRange().getDisplayValues();
      for (let i = 1; i < dataIA.length; i++) {
        if (podeVer(dataIA[i][1], dataIA[i][2])) {
          resultados.push({ tipo: "ind_almoxarifado", empresa: String(dataIA[i][1]).trim(), usuario: String(dataIA[i][3]).trim(), data_auditoria: dataIA[i][4], turno: dataIA[i][5], material: dataIA[i][6], qtd_sistema: dataIA[i][7], qtd_fisica: dataIA[i][8], divergencia: dataIA[i][9], custo_unit: dataIA[i][10], impacto: dataIA[i][11], motivo: dataIA[i][12], filial: dataIA[i][2] });
        }
      }
    }
  } catch (err) { }
  // 14. Busca Inventário Indústria
  try {
    const sheetII = SpreadsheetApp.openById(ID_IND_INVENTARIO).getSheets()[0];
    if (sheetII.getLastRow() > 1) {
      const dataII = sheetII.getDataRange().getDisplayValues();
      for (let i = 1; i < dataII.length; i++) {
        if (podeVer(dataII[i][1], dataII[i][2])) {
          resultados.push({ tipo: "ind_inventario", empresa: String(dataII[i][1]).trim(), usuario: String(dataII[i][3]).trim(), data_registro: dataII[i][0], lote: dataII[i][4], gtin: dataII[i][5], descricao: dataII[i][6], quantidade: dataII[i][7], id_inventario: dataII[i][8], status: dataII[i][9], filial: dataII[i][2] });
        }
      }
    }
  } catch (err) { }
  // ESTAS DUAS LINHAS SÃO VITAIS PARA FECHAR A FUNÇÃO!
  return ContentService.createTextOutput(JSON.stringify(resultados)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// FUNÇÃO DE AUTORIZAÇÃO DE ROTAS GLOBAIS
// ==========================================
function autorizarAcesso() {
  SpreadsheetApp.openById(ID_QUEBRAS);
  SpreadsheetApp.openById(ID_DOCAS);
  SpreadsheetApp.openById(ID_VALIDADE);
  SpreadsheetApp.openById(ID_FURTOS);
  SpreadsheetApp.openById(ID_PRECOS);
  SpreadsheetApp.openById(ID_CAIXA);
  SpreadsheetApp.openById(ID_INVENTARIO);
  SpreadsheetApp.openById(ID_TAREFAS);
  SpreadsheetApp.openById(ID_PRODUTOS); // Autoriza Master Data
}