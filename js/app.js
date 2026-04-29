// ==========================================
// 1. IMPORTS & CONFIGURAÇÃO DO FIREBASE
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, query, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCAcWktRvA6670OhbiewfCMW3MADNU5YmE",
    authDomain: "lucroseguro-app.firebaseapp.com",
    projectId: "lucroseguro-app",
    storageBucket: "lucroseguro-app.firebasestorage.app",
    messagingSenderId: "414461858129",
    appId: "1:414461858129:web:5ccd546015674f8d8b0370",
    measurementId: "G-RP5X05DSHF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Endpoint do Google Apps Script (Controladoria)
const GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxmr0Y-4fq5OigxSxSMaAqnXTDiM7ekaL9EA7j1Bzf-zyQ311qoE7elqAoIYgoFT_EhJg/exec";

// ==========================================
// 2. VARIÁVEIS GLOBAIS E ESTADOS
// ==========================================
let chartMotivosInstance = null;
let chartFurtosPerfilInstance = null;
let chartFurtosLocaisInstance = null;
let sheetsDataRaw = [];
let produtosMestre = [];
let itemEmAuditoria = null;
let produtosFurto = [];

let currentUserEmpresa = "";
let currentUserFilial = "";
let currentUserRole = "operacional";

if (window.lucide) lucide.createIcons();

// ==========================================
// 3. FUNÇÕES UTILITÁRIAS E ATUALIZAÇÃO UI
// ==========================================
const autoFillDates = () => {
    const hoje = new Date();
    const dataFormatada = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    ['p-data', 'f-data', 'c-data', 't-prazo', 'r-data', 'ir-data', 'ip-data', 'iq-data', 'ia-data'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.value = dataFormatada;
    });
};
autoFillDates();

const parseLocalFloat = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return parseFloat(String(val).replace(/\./g, '').replace(',', '.')) || 0;
};

const extrairAnoMes = (dataRaw) => {
    if (!dataRaw) return "";
    let str = String(dataRaw).trim();
    if (str.includes('/')) {
        let dataParte = str.split(' ')[0];
        let pedacos = dataParte.split('/');
        if (pedacos.length >= 3) return `${pedacos[2]}-${pedacos[1].padStart(2, '0')}`;
    } else if (str.includes('-')) {
        return str.substring(0, 7);
    }
    return str;
};

window.exportDataToCSV = (tipo, filename) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === tipo);
    if (dataToExport.length === 0) { alert("Sem dados processados para exportar."); return; }
    const headers = Object.keys(dataToExport[0]).join(";");
    const rows = dataToExport.map(obj => Object.values(obj).map(val => `"${String(val).replace(/"/g, '""')}"`).join(";")).join("\n");
    const csvContent = "\uFEFF" + headers + "\n" + rows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename + "_" + currentUserFilial.replace(/[^a-zA-Z0-9]/g, '') + ".csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
};

// Centralizador de renderização para uso na memória (Instantâneo)
window.triggerAllRenders = () => {
    try { window.renderQuebrasDashboard(); } catch (e) { } try { window.renderRefugoDashboard(); } catch (e) { } try { window.renderParadasDashboard(); } catch (e) { } try { window.renderQualidadeDashboard(); } catch (e) { } try { window.renderAlmoxarifadoDashboard(); } catch (e) { } try { window.renderListaInventariosInd(); } catch (e) { } try { window.renderQualidadeDashboard(); } catch (e) { } try { window.renderAlmoxarifadoDashboard(); } catch (e) { } try { window.renderListaInventariosInd(); } catch (e) { }
    try { window.renderPrecoDashboard(); } catch (e) { }
    try { window.renderDocasDashboard(); } catch (e) { }
    try { window.renderValidadeDashboard(); } catch (e) { }
    try { window.renderFurtosDashboard(); } catch (e) { }
    try { window.renderCaixaDashboard(); } catch (e) { }
    try { window.renderTarefasDashboard(); } catch (e) { }
    try { window.renderListaInventarios(); } catch (e) { }
    if (window.lucide) lucide.createIcons();
};

// ==========================================
// 4. MOTOR DE INTEGRAÇÃO (CACHE SWR E OTIMISTA)
// ==========================================
const submitToSheets = async (form, btnId, msgSuccessId, msgErrorId, payload, btnOriginalText) => {
    const btn = document.getElementById(btnId);
    const msgSuccess = document.getElementById(msgSuccessId);
    const msgError = document.getElementById(msgErrorId);

    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A enviar...'; }
    if (msgSuccess) msgSuccess.classList.add('hidden');
    if (msgError) msgError.classList.add('hidden');
    if (window.lucide) lucide.createIcons();

    // Injeção otimista de dados na tela do cliente
    if (payload.tipo !== 'atualizar_validade' && payload.tipo !== 'concluir_tarefa' && payload.tipo !== 'fechar_inventario' && payload.tipo !== 'atualizar_rebaixa_validade') {
        const payloadExists = sheetsDataRaw.some(i => JSON.stringify(i) === JSON.stringify(payload));
        if (!payloadExists) {
            const payloadLocal = { ...payload };
            // Se for furto, converte o texto novamente para lista para a nossa memória cache interna
            if (payloadLocal.tipo === 'furto' && typeof payloadLocal.produtos === 'string') {
                payloadLocal.produtos = JSON.parse(payloadLocal.produtos);
            }
            sheetsDataRaw.push(payloadLocal);
            window.triggerAllRenders();
        }
    }

    try {
        const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
            method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });

        // Leitura à prova de falhas: evita o erro <!DOCTYPE HTML> na tela
        const textResponse = await response.text();
        let result;
        try {
            result = JSON.parse(textResponse);
        } catch (err) {
            console.error("Erro interno do Google Apps Script:", textResponse);
            throw new Error("O Google Sheets rejeitou a gravação. Verifique as configurações da planilha.");
        }

        if (result.status === 'success') {
            if (payload.tipo === 'atualizar_validade') {
                const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(payload.gtin) && i.data_validade === payload.data_validade);
                if (idx !== -1) {
                    if (parseFloat(payload.quantidade) <= 0) sheetsDataRaw.splice(idx, 1);
                    else sheetsDataRaw[idx].quantidade = payload.quantidade;
                }
                window.triggerAllRenders();
            }

            // MOTOR DE PRESERVAÇÃO DA FILIAL
            if (form) {
                // Descobre se o formulário atual tem uma caixa de filial e memoriza o valor
                const caixaFilial = form.querySelector('#q-filial-lancamento, #r-filial-lancamento, #v-filial-lancamento, #f-filial, #p-filial-lancamento, #c-filial-lancamento, #t-filial');
                const filialSalva = caixaFilial ? caixaFilial.value : null;

                // Limpa todos os outros campos (GTIN, Preço, Quantidade)
                form.reset();

                // Devolve a filial memorizada à caixa, evitando que o inspetor tenha de a selecionar novamente
                if (caixaFilial && filialSalva) {
                    caixaFilial.value = filialSalva;
                }
            }
            if (msgSuccess) { msgSuccess.classList.remove('hidden'); setTimeout(() => msgSuccess.classList.add('hidden'), 5000); }
            sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre]));
        } else {
            throw new Error(result.message || "Erro desconhecido na planilha.");
        }
    } catch (error) {
        if (msgError) { msgError.innerText = error.message; msgError.classList.remove('hidden'); }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = btnOriginalText; }
        if (window.lucide) lucide.createIcons();
    }
};

window.fetchSheetsDataComHierarquia = async () => {
    const loadingQ = document.getElementById('loading-quebras');
    const loadingMain = document.getElementById('loading-data');
    const cacheKey = `lucroData_${currentUserFilial}`;

    // Configuração dos filtros iniciais
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    ['quebra', 'docas', 'validade', 'furtos', 'preco', 'caixa', 'inv', 'tar', 'refugo', 'paradas', 'qualidade', 'almoxarifado', 'contagem-ind'].forEach(id => {
        const filtroMes = document.getElementById(`filtro-mes-${id}`);
        const filtroFilial = document.getElementById(`filtro-filial-${id}`);
        if (filtroMes && !filtroMes.value) filtroMes.value = mesAtual;

        const trg = () => {
            if (id === 'quebra') window.renderQuebrasDashboard();
            if (id === 'docas') window.renderDocasDashboard();
            if (id === 'validade') window.renderValidadeDashboard();
            if (id === 'furtos') window.renderFurtosDashboard();
            if (id === 'preco') window.renderPrecoDashboard();
            if (id === 'caixa') window.renderCaixaDashboard();
            if (id === 'inv') window.renderListaInventarios();
            if (id === 'tar') window.renderTarefasDashboard(); if (id === 'refugo') window.renderRefugoDashboard(); if (id === 'paradas') window.renderParadasDashboard();
        };
        if (filtroMes) filtroMes.onchange = trg;
        if (filtroFilial) filtroFilial.onchange = trg;
    });

    // 1. CARREGAMENTO INSTANTÂNEO (SWR CACHE)
    try {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
            const parsed = JSON.parse(cachedData);
            sheetsDataRaw = parsed.filter(i => i.tipo !== 'produto');
            produtosMestre = parsed.filter(i => i.tipo === 'produto');
            window.triggerAllRenders();
            if (loadingQ) loadingQ.classList.add('hidden');
            if (loadingMain) loadingMain.classList.add('hidden');
        } else {
            if (loadingQ) loadingQ.classList.remove('hidden');
            if (loadingMain) loadingMain.classList.remove('hidden');
        }
    } catch (e) { console.error("Erro no Cache", e); }

    // 2. BUSCA NO BACKGROUND BLINDADA
    try {
        const userEmailReq = auth.currentUser ? auth.currentUser.email : 'anonimo';
        const urlSegura = `${GOOGLE_SHEETS_WEBAPP_URL}?empresa=${encodeURIComponent(currentUserEmpresa)}&filial=${encodeURIComponent(currentUserFilial)}&role=${encodeURIComponent(currentUserRole)}&user=${encodeURIComponent(userEmailReq)}&t=${Date.now()}`;

        const res = await fetch(urlSegura);
        const textData = await res.text(); // Lê como texto primeiro para evitar crash se a Google falhar

        try {
            const data = JSON.parse(textData);
            if (data && Array.isArray(data)) {
                // BLINDAGEM: Impede que o limite de memória do navegador trave o site
                try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (err) { console.warn("Cache ignorado: Banco de produtos muito grande para a memória local."); }

                sheetsDataRaw = data.filter(i => i.tipo !== 'produto');
                produtosMestre = data.filter(i => i.tipo === 'produto');
                window.triggerAllRenders();

                // Atualiza a UI do consultor automaticamente se ele estiver logado
                if (currentUserRole === 'admin' && typeof window.calcularKpiConsultor === 'function') {
                    window.calcularKpiConsultor();
                }
            }
        } catch (parseErr) {
            console.error("A API não retornou um JSON válido:", textData);
        }

    } catch (e) {
        console.error("Erro ao comunicar com o Google Sheets:", e);
    } finally {
        if (loadingQ) loadingQ.classList.add('hidden');
        if (loadingMain) loadingMain.classList.add('hidden');
    }
};

// ==========================================
// 5. MOTORES DE DASHBOARDS (VISTAS)
// ==========================================
window.renderQuebrasDashboard = () => {
    const contentQ = document.getElementById('quebras-dashboard-content');
    const emptyQ = document.getElementById('empty-state-quebras');
    const filtroMes = document.getElementById('filtro-mes-quebra')?.value;
    const filtroFilial = document.getElementById('filtro-filial-quebra')?.value;

    if (!filtroMes) return;

    let dadosMes = sheetsDataRaw.filter(i => i.tipo === 'quebra' && i.mes && extrairAnoMes(i.mes) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dadosMes = dadosMes.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dadosMes.length === 0) { if (contentQ) contentQ.classList.add('hidden'); if (emptyQ) emptyQ.classList.remove('hidden'); return; }

    if (emptyQ) emptyQ.classList.add('hidden'); if (contentQ) contentQ.classList.remove('hidden');

    let totalRs = 0; let totalQtd = 0; const motivosMap = {}; const rankingMap = {};
    dadosMes.forEach(item => {
        const qtd = parseLocalFloat(item.quantidade); const custo = parseLocalFloat(item.custo);
        const valorTotal = qtd * custo; const motivo = item.motivo || 'Outros'; const produto = item.descricao || 'Produto sem nome';
        totalRs += valorTotal; totalQtd += qtd;
        if (!motivosMap[motivo]) motivosMap[motivo] = 0; motivosMap[motivo] += valorTotal;
        if (!rankingMap[produto]) rankingMap[produto] = 0; rankingMap[produto] += valorTotal;
    });

    if (document.getElementById('ui-quebra-total-rs')) document.getElementById('ui-quebra-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (document.getElementById('ui-quebra-total-qtd')) document.getElementById('ui-quebra-total-qtd').innerText = totalQtd.toLocaleString('pt-BR');

    const divChart = document.querySelector("#chart-motivos");
    if (divChart && typeof ApexCharts !== 'undefined') {
        if (chartMotivosInstance) chartMotivosInstance.destroy();
        chartMotivosInstance = new ApexCharts(divChart, {
            series: Object.values(motivosMap), labels: Object.keys(motivosMap),
            chart: { type: 'donut', height: 280, fontFamily: 'Inter, sans-serif' }, colors: ['#0A2540', '#008950', '#f97316', '#eab308', '#ef4444', '#8b5cf6'],
            dataLabels: { enabled: false }, legend: { position: 'right' },
            tooltip: { y: { formatter: function (val) { return "R$ " + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } } }
        });
        chartMotivosInstance.render();
    }

    const divRanking = document.getElementById('ranking-list');
    if (divRanking) {
        const rankingArray = Object.keys(rankingMap).map(key => ({ produto: key, valor: rankingMap[key] })).sort((a, b) => b.valor - a.valor);
        divRanking.innerHTML = '';
        rankingArray.slice(0, 5).forEach((item, index) => {
            divRanking.innerHTML += `<div class="flex justify-between items-center p-3 hover:bg-slate-50 rounded-lg transition-colors border-b border-slate-100 last:border-0"><div class="flex items-center gap-3"><span class="text-lg font-bold text-slate-300 w-5">${index + 1}º</span><span class="font-medium text-slate-700">${item.produto}</span></div><span class="font-bold text-red-600">R$ ${item.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;
        });
        if (rankingArray.length === 0) divRanking.innerHTML = '<p class="text-sm text-slate-400 italic py-2">Nenhum dado para o ranking.</p>';
    }
};

window.renderDocasDashboard = () => {
    const contentD = document.getElementById('docas-dashboard-content'); const emptyD = document.getElementById('empty-state-docas');
    const filtroMes = document.getElementById('filtro-mes-docas')?.value; const filtroFilial = document.getElementById('filtro-filial-docas')?.value;

    let dadosDocas = sheetsDataRaw.filter(i => i.tipo === 'recebimento');
    if (filtroMes) dadosDocas = dadosDocas.filter(i => extrairAnoMes(i.data_entrega) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dadosDocas = dadosDocas.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dadosDocas.length === 0) { if (contentD) contentD.classList.add('hidden'); if (emptyD) emptyD.classList.remove('hidden'); return; }
    if (emptyD) emptyD.classList.add('hidden'); if (contentD) contentD.classList.remove('hidden');

    let totalDivergencias = 0; let custoDivergencias = 0; const divLista = document.getElementById('docas-lista-divergencias');
    dadosDocas.forEach(item => { totalDivergencias += parseLocalFloat(item.quantidade); custoDivergencias += (parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo)); });

    if (document.getElementById('ui-docas-total')) document.getElementById('ui-docas-total').innerText = totalDivergencias.toLocaleString('pt-BR');
    if (document.getElementById('ui-docas-custo')) document.getElementById('ui-docas-custo').innerText = 'R$ ' + custoDivergencias.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (divLista) {
        divLista.innerHTML = '';
        dadosDocas.slice(-5).reverse().forEach(item => {
            divLista.innerHTML += `<div class="p-3 border-b border-slate-100 last:border-0"><p class="font-bold text-navy">${item.fornecedor || 'Fornecedor'}</p><p class="text-sm text-slate-600">NF: ${item.nf || 'S/N'} | Divergência: <span class="font-bold text-red-600">${item.quantidade} un</span></p></div>`;
        });
    }
};

window.renderValidadeDashboard = () => {
    const contentV = document.getElementById('validade-dashboard-content'); const emptyV = document.getElementById('empty-state-validade');
    const filtroFilial = document.getElementById('filtro-filial-validade')?.value;

    let dadosValidade = sheetsDataRaw.filter(i => i.tipo === 'validade');
    if (filtroFilial && filtroFilial !== 'todas') dadosValidade = dadosValidade.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dadosValidade.length === 0) { if (contentV) contentV.classList.add('hidden'); if (emptyV) emptyV.classList.remove('hidden'); return; }
    if (emptyV) emptyV.classList.add('hidden'); if (contentV) contentV.classList.remove('hidden');

    let totalItens = 0; let custoRisco = 0; const divLista = document.getElementById('validade-lista-radar');
    dadosValidade.forEach(item => { totalItens += parseLocalFloat(item.quantidade); custoRisco += (parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo)); });

    if (document.getElementById('ui-validade-total')) document.getElementById('ui-validade-total').innerText = totalItens.toLocaleString('pt-BR');
    if (document.getElementById('ui-validade-custo')) document.getElementById('ui-validade-custo').innerText = 'R$ ' + custoRisco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (divLista) {
        divLista.innerHTML = '';
        const dadosOrdenados = [...dadosValidade].sort((a, b) => { const dA = String(a.data_validade).split('/').reverse().join(''); const dB = String(b.data_validade).split('/').reverse().join(''); return dA.localeCompare(dB); });

        dadosOrdenados.forEach(item => {
            const riscoItem = parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo);
            const itemEncoded = encodeURIComponent(JSON.stringify(item));
            let dataVencimento; let partesData = String(item.data_validade).split('/');
            if (partesData.length === 3) { dataVencimento = new Date(partesData[2], partesData[1] - 1, partesData[0]); } else { dataVencimento = new Date(item.data_validade + 'T00:00:00'); }

            let hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            let diffTempo = dataVencimento.getTime() - hoje.getTime(); let diasRestantes = Math.ceil(diffTempo / (1000 * 3600 * 24));

            let corSinalizacao = "bg-emerald"; if (diasRestantes < 0) corSinalizacao = "bg-red-600 animate-pulse"; else if (diasRestantes <= 15) corSinalizacao = "bg-yellow-500";
            let dataExibicao = item.data_validade;
            if (dataExibicao && String(dataExibicao).includes('-')) { const p = String(dataExibicao).split('-'); if (p.length === 3) dataExibicao = `${p[2]}/${p[1]}/${p[0]}`; }

            const isRebaixado = item.rebaixado === 'SIM';
            const corCard = isRebaixado ? 'border-gold/50 bg-gold/5' : 'border-slate-200 bg-white';
            const corTextoCheck = isRebaixado ? 'text-gold' : 'text-slate-400';

            divLista.innerHTML += `<div class="p-3 mb-2 ${corCard} border rounded-lg flex flex-col md:flex-row md:items-center gap-3 shadow-sm min-w-0 transition-all"><div class="flex items-center gap-3 flex-1 min-w-0 text-left"><div class="w-3 h-3 rounded-full shrink-0 ${corSinalizacao}"></div><div class="flex-1 min-w-0"><p class="font-bold text-navy text-sm mb-1 truncate">${item.descricao || 'Produto'}</p><div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500"><span>Vence: <strong class="text-slate-700">${dataExibicao}</strong></span><span class="text-slate-300">|</span><span>GTIN: ${item.gtin || '-'}</span><span class="text-slate-300">|</span><span>Qtd: <strong class="text-slate-700">${item.quantidade} un</strong></span><span class="text-slate-300">|</span><span>Risco: <strong class="text-red-600">R$ ${riscoItem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span></div></div></div><div class="flex items-center justify-end gap-3 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-3 mt-2 md:mt-0"><label class="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold ${corTextoCheck} hover:text-gold transition-colors uppercase tracking-wider"><input type="checkbox" onchange="window.marcarRebaixaValidade('${itemEncoded}', this)" class="w-4 h-4 rounded border-slate-300 text-gold focus:ring-gold cursor-pointer" ${isRebaixado ? 'checked' : ''}> Rebaixado</label><button onclick="abrirModalAuditoria('${itemEncoded}')" class="bg-slate-50 hover:bg-slate-200 border border-slate-200 text-navy text-xs font-bold px-4 py-2 rounded-lg transition-colors whitespace-nowrap shadow-sm">Auditar</button></div></div>`;
        });
    }
};

window.abrirModalAuditoria = (itemJson) => {
    itemEmAuditoria = JSON.parse(decodeURIComponent(itemJson));
    document.getElementById('modal-produto').innerText = itemEmAuditoria.descricao;
    document.getElementById('modal-vencimento').innerText = itemEmAuditoria.data_validade;
    document.getElementById('modal-qtd-anterior').innerText = itemEmAuditoria.quantidade;
    document.getElementById('modal-nova-qtd').value = '';
    document.getElementById('modal-auditoria').classList.remove('hidden');
};
// Função para fechar o Modal de Auditoria
window.fecharModalAuditoria = () => {
    const modal = document.getElementById('modal-auditoria');
    if (modal) modal.classList.add('hidden');
    itemEmAuditoria = null; // Limpa a memória por segurança
};

// Bónus UX: Fechar o modal se o inspetor clicar fora da caixa branca (no fundo escuro)
const modalAuditoriaBg = document.getElementById('modal-auditoria');
if (modalAuditoriaBg) {
    modalAuditoriaBg.addEventListener('click', (e) => {
        if (e.target === modalAuditoriaBg) window.fecharModalAuditoria();
    });
}

window.marcarRebaixaValidade = async (itemEncoded, checkboxEl) => {
    const item = JSON.parse(decodeURIComponent(itemEncoded)); const statusRebaixa = checkboxEl.checked ? "SIM" : "NÃO";
    checkboxEl.disabled = true;
    const payload = { tipo: "atualizar_rebaixa_validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: item.filial, gtin: item.gtin, data_validade: item.data_validade, rebaixado: statusRebaixa };

    // Atualização otimista local
    const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(item.gtin) && i.data_validade === item.data_validade && i.filial === item.filial);
    if (idx > -1) sheetsDataRaw[idx].rebaixado = statusRebaixa;
    window.renderValidadeDashboard();

    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); }
    catch (e) { alert("Erro de conexão."); checkboxEl.checked = !checkboxEl.checked; } finally { checkboxEl.disabled = false; }
};

window.renderFurtosDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-furtos')?.value; const filtroFilial = document.getElementById('filtro-filial-furtos')?.value;
    let dadosFurtos = sheetsDataRaw.filter(i => i.tipo === 'furto');
    if (filtroMes) dadosFurtos = dadosFurtos.filter(i => i.data_ocorrencia && extrairAnoMes(i.data_ocorrencia) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dadosFurtos = dadosFurtos.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    let totalRs = 0; let ocorrenciasMap = {}; let preventivas = 0; let generoMap = { 'Homem': 0, 'Mulher': 0, 'Outro': 0 }; let locaisMap = {};
    dadosFurtos.forEach(item => {
        totalRs += parseLocalFloat(item.subtotal); const chaveUnica = item.data_hora_registro + "_" + item.filial;
        if (!ocorrenciasMap[chaveUnica]) ocorrenciasMap[chaveUnica] = { abordagem: item.abordagem, genero: item.genero, local: item.local };
    });

    const ocorrencias = Object.values(ocorrenciasMap);
    ocorrencias.forEach(o => {
        if (String(o.abordagem).toLowerCase() === 'preventiva') preventivas++;
        if (generoMap[o.genero] !== undefined) generoMap[o.genero]++; else generoMap['Outro']++;
        const local = String(o.local).trim().toUpperCase(); if (!locaisMap[local]) locaisMap[local] = 0; locaisMap[local]++;
    });

    if (document.getElementById('ui-furto-total-rs')) document.getElementById('ui-furto-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (document.getElementById('ui-furto-total-ocorrencias')) document.getElementById('ui-furto-total-ocorrencias').innerText = ocorrencias.length;
    if (document.getElementById('ui-furto-preventivo')) document.getElementById('ui-furto-preventivo').innerText = (ocorrencias.length > 0 ? Math.round((preventivas / ocorrencias.length) * 100) : 0) + '%';

    const divChartPerfil = document.querySelector("#chart-furtos-perfil");
    if (divChartPerfil && typeof ApexCharts !== 'undefined') {
        if (chartFurtosPerfilInstance) chartFurtosPerfilInstance.destroy(); divChartPerfil.innerHTML = '';
        chartFurtosPerfilInstance = new ApexCharts(divChartPerfil, { series: Object.values(generoMap), labels: Object.keys(generoMap), chart: { type: 'donut', height: 260, fontFamily: 'Inter, sans-serif' }, colors: ['#0A2540', '#008950', '#eab308'], dataLabels: { enabled: false }, legend: { position: 'bottom' } }); chartFurtosPerfilInstance.render();
    }
    const divChartLocais = document.querySelector("#chart-furtos-locais");
    if (divChartLocais && typeof ApexCharts !== 'undefined') {
        if (chartFurtosLocaisInstance) chartFurtosLocaisInstance.destroy(); divChartLocais.innerHTML = '';
        const locaisArray = Object.keys(locaisMap).map(k => ({ local: k, qtd: locaisMap[k] })).sort((a, b) => b.qtd - a.qtd).slice(0, 5);
        chartFurtosLocaisInstance = new ApexCharts(divChartLocais, { series: [{ name: 'Ocorrências', data: locaisArray.map(l => l.qtd) }], chart: { type: 'bar', height: 260, fontFamily: 'Inter, sans-serif', toolbar: { show: false } }, plotOptions: { bar: { borderRadius: 4, horizontal: true } }, dataLabels: { enabled: false }, xaxis: { categories: locaisArray.map(l => l.local) }, colors: ['#dc2626'] }); chartFurtosLocaisInstance.render();
    }
};

window.renderPrecoDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-preco')?.value; const filtroFilial = document.getElementById('filtro-filial-preco')?.value;
    let dadosPreco = sheetsDataRaw.filter(i => i.tipo === 'auditoria_preco');
    if (filtroMes) dadosPreco = dadosPreco.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dadosPreco = dadosPreco.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    let divergentes = 0; let semPreco = 0;
    dadosPreco.forEach(item => { if (item.sem_preco === 'SIM') semPreco++; else if (parseLocalFloat(item.preco_sistema) !== parseLocalFloat(item.preco_gondola)) divergentes++; });
    if (document.getElementById('ui-preco-total')) document.getElementById('ui-preco-total').innerText = dadosPreco.length;
    if (document.getElementById('ui-preco-divergente')) document.getElementById('ui-preco-divergente').innerText = divergentes;
    if (document.getElementById('ui-preco-sempreco')) document.getElementById('ui-preco-sempreco').innerText = semPreco;
};

window.renderCaixaDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-caixa')?.value; const filtroFilial = document.getElementById('filtro-filial-caixa')?.value;
    let dadosCaixa = sheetsDataRaw.filter(i => i.tipo === 'caixa_central');
    if (filtroMes) dadosCaixa = dadosCaixa.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dadosCaixa = dadosCaixa.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    let totalRs = 0; dadosCaixa.forEach(item => { totalRs += parseLocalFloat(item.valor_falta); });
    if (document.getElementById('ui-caixa-total-ocorrencias')) document.getElementById('ui-caixa-total-ocorrencias').innerText = dadosCaixa.length;
    if (document.getElementById('ui-caixa-total-rs')) document.getElementById('ui-caixa-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

window.renderTarefasDashboard = () => {
    const divSis = document.getElementById('lista-tarefas-sistema'); const divMan = document.getElementById('lista-tarefas-manuais'); if (!divSis || !divMan) return;
    const filtroFilial = document.getElementById('filtro-filial-tar')?.value; let htmlSis = ''; let htmlMan = ''; const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    let validades = sheetsDataRaw.filter(i => i.tipo === 'validade' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') validades = validades.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    validades.forEach(v => {
        let pData = String(v.data_validade).split('/'); let dVenc = pData.length === 3 ? new Date(pData[2], pData[1] - 1, pData[0]) : new Date(v.data_validade + 'T00:00:00'); let dias = Math.ceil((dVenc.getTime() - hoje.getTime()) / (1000 * 3600 * 24));
        if (dias <= 15 && dias >= 0) {
            const itemEnc = encodeURIComponent(JSON.stringify(v));
            htmlSis += `<div class="p-3 bg-red-50 border border-red-200 rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-3"><div class="flex items-start gap-3"><i class="w-5 h-5 text-red-600 mt-1" data-lucide="alert-triangle"></i><div><p class="text-sm font-bold text-red-800">Risco: ${v.descricao || 'Produto sem nome'}</p><p class="text-xs text-red-600 font-medium">Vence em ${dias} dias | Filial: ${v.filial}</p></div></div><button onclick="abrirModalAuditoria('${itemEnc}')" class="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded shadow-sm transition-colors">Auditar</button></div>`;
        }
    });

    let tarefas = sheetsDataRaw.filter(i => i.tipo === 'tarefa' && i.status === 'PENDENTE' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') tarefas = tarefas.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    tarefas.forEach(t => {
        const tituloEnc = encodeURIComponent(t.titulo);
        htmlMan += `<div class="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between transition-opacity duration-300"><div class="flex items-center gap-3"><input type="checkbox" onchange="window.concluirTarefa('${tituloEnc}', '${t.filial}', this)" class="w-5 h-5 rounded border-slate-300 text-navy focus:ring-navy cursor-pointer"><div><p class="text-sm font-bold text-navy">${t.titulo}</p><p class="text-xs text-slate-500 font-medium">Prazo: ${t.prazo} | Filial: ${t.filial}</p></div></div></div>`;
    });

    divSis.innerHTML = htmlSis || '<p class="text-sm text-slate-400 text-center py-4">Nenhum risco sistêmico detectado.</p>'; divMan.innerHTML = htmlMan || '<p class="text-sm text-slate-400 text-center py-4">Nenhuma demanda pendente.</p>';
};

window.concluirTarefa = async (tituloEncoded, filial, checkboxEl) => {
    checkboxEl.disabled = true; const titulo = decodeURIComponent(tituloEncoded); const parentDiv = checkboxEl.closest('.p-3.bg-slate-50'); if (parentDiv) parentDiv.style.opacity = '0.4';

    // Atualização otimista
    const idx = sheetsDataRaw.findIndex(x => x.tipo === 'tarefa' && x.titulo === titulo && x.filial === filial && x.status === 'PENDENTE');
    if (idx > -1) sheetsDataRaw[idx].status = 'CONCLUÍDA'; window.renderTarefasDashboard();

    const payload = { tipo: "concluir_tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, titulo: titulo };
    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); }
    catch (e) { alert("Erro ao concluir."); checkboxEl.disabled = false; checkboxEl.checked = false; if (parentDiv) parentDiv.style.opacity = '1'; }
};

window.renderListaInventarios = () => {
    const tbody = document.getElementById('inv-tbody-consulta'); if (!tbody) return;
    const filtroFilial = document.getElementById('filtro-filial-inv')?.value;
    let inventarios = sheetsDataRaw.filter(i => i.tipo === 'inventario' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') inventarios = inventarios.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    const mapInv = {};
    inventarios.forEach(i => {
        if (!i.id_inventario) return;
        if (!mapInv[i.id_inventario]) mapInv[i.id_inventario] = { id: i.id_inventario, filial: i.filial, qtdLeituras: 0, fechado: false };
        if (i.status === 'FECHADO' || i.gtin === 'FECHAMENTO') mapInv[i.id_inventario].fechado = true; else if (i.gtin !== 'LISTA_DIRIGIDA') mapInv[i.id_inventario].qtdLeituras++;
    });

    const listaArr = Object.values(mapInv).sort((a, b) => { if (a.fechado !== b.fechado) return a.fechado ? 1 : -1; return b.id.localeCompare(a.id); });
    if (listaArr.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400 italic">Nenhum inventário localizado.</td></tr>'; return; }

    let html = '';
    listaArr.forEach(inv => {
        const statusBadge = inv.fechado ? `<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-slate-200"><i class="w-3 h-3 inline pb-0.5" data-lucide="lock"></i> Fechado</span>` : `<span class="bg-emerald/10 text-emerald px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-emerald/20"><i class="w-3 h-3 inline pb-0.5" data-lucide="unlock"></i> Aberto</span>`;
        const btnContinuar = !inv.fechado ? `<button type="button" onclick="abrirTelaBipagem('${inv.id}', '${inv.filial}')" class="text-xs bg-navy text-white hover:bg-navyLight px-3 py-1.5 rounded shadow-sm inline-flex items-center gap-1"><i class="w-3 h-3" data-lucide="scan-barcode"></i> Contar</button>` : '';
        const btnExportar = `<button type="button" onclick="exportarInventarioId('${inv.id}')" class="text-xs bg-white text-emerald border border-slate-200 px-3 py-1.5 rounded shadow-sm inline-flex items-center gap-1"><i class="w-3 h-3" data-lucide="file-spreadsheet"></i> Relatório</button>`;
        html += `<tr class="hover:bg-slate-50 transition-colors border-b border-slate-100"><td class="px-6 py-4 font-bold text-navy">${inv.id}</td><td class="px-6 py-4 text-slate-600 text-xs">${inv.filial}</td><td class="px-6 py-4">${statusBadge}</td><td class="px-6 py-4 text-center font-medium text-slate-700">${inv.qtdLeituras}</td><td class="px-6 py-4 text-right space-x-2">${btnContinuar} ${btnExportar}</td></tr>`;
    });
    tbody.innerHTML = html; if (window.lucide) lucide.createIcons();
    if (typeof window.renderDashboardInventarioMaster === 'function') window.renderDashboardInventarioMaster();
};

window.renderDashboardInventarioMaster = () => {
    const selFilial = document.getElementById('filtro-dash-inv-master');
    const inputData = document.getElementById('filtro-data-dash-inv-master');
    if (!selFilial || !inputData) return;

    if (!inputData.value) {
        const hoje = new Date();
        inputData.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        inputData.addEventListener('change', window.renderDashboardInventarioMaster);
    }

    if (selFilial.options.length <= 1) {
        const selectFonte = document.getElementById('filtro-filial-inv');
        if (selectFonte && selectFonte.options.length > 1) {
            Array.from(selectFonte.options).forEach(opt => {
                if (opt.value !== 'todas' && opt.value !== '') {
                    const newOpt = document.createElement('option');
                    newOpt.value = opt.value;
                    newOpt.innerText = opt.text;
                    selFilial.appendChild(newOpt);
                }
            });
            selFilial.addEventListener('change', window.renderDashboardInventarioMaster);
        }
    }

    const filialFiltro = selFilial.value;
    const mesFiltro = inputData.value;

    const fechados = new Set();
    sheetsDataRaw.forEach(i => {
        if (i.tipo === 'inventario' && i.gtin === 'FECHAMENTO') {
            fechados.add(i.id_inventario);
        }
    });

    let perdaDesconhecida = 0;
    let perdaAdministrativa = 0;

    // Passo 2: Calcular totais financeiros apenas para as bipagens dos fechados
    sheetsDataRaw.forEach(i => {
        if (i.tipo === 'inventario' && i.gtin !== 'FECHAMENTO' && i.gtin !== 'LISTA_DIRIGIDA') {
            if (fechados.has(i.id_inventario)) {
                // Filtro de filial vindo do select
                if (filialFiltro === 'Todas as Minhas Lojas' || String(i.filial).trim() === String(filialFiltro).trim()) {

                    // Filtro Temporal
                    let matchData = false;
                    const dataReg = String(i.data_registro || '').trim(); // DD/MM/YYYY HH:MM:SS
                    if (dataReg.length >= 10) {
                        const partesData = dataReg.split(' ')[0].split('/'); // [DD, MM, YYYY]
                        if (partesData.length >= 3) {
                            const anoMesRegistro = `${partesData[2]}-${partesData[1]}`;
                            if (anoMesRegistro === mesFiltro) {
                                matchData = true;
                            }
                        }
                    }

                    if (matchData) {
                        const custo = parseFloat(String(i.custo).replace(',', '.')) || 0;
                        const qtd = parseFloat(String(i.quantidade).replace(',', '.')) || 0;

                        // CORREÇÃO: Mantemos o sinal real para que os estornos (qtd negativa) abatam do total
                        const valorFinanceiro = custo * qtd;
                        const motivo = String(i.motivo || '').trim();

                        if (motivo === 'Não Identificado' || motivo === '') {
                            perdaDesconhecida += valorFinanceiro;
                        } else {
                            perdaAdministrativa += valorFinanceiro;
                        }
                    }
                }
            }
        }
    });

    // Passo 3: Atualizar DOM (Aplicando a trava de zero apenas no resultado final consolidado)
    perdaDesconhecida = Math.max(0, perdaDesconhecida);
    perdaAdministrativa = Math.max(0, perdaAdministrativa);

    const elDesc = document.getElementById('ui-master-perda-desc');
    const elAdmin = document.getElementById('ui-master-perda-admin');
    if (elDesc) elDesc.innerText = perdaDesconhecida.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (elAdmin) elAdmin.innerText = perdaAdministrativa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

window.abrirTelaBipagem = (idInv, filial) => { document.getElementById('inv-tela-selecao').classList.add('hidden'); document.getElementById('inv-tela-bipagem').classList.remove('hidden'); document.getElementById('ui-inv-id').innerText = idInv; document.getElementById('ui-inv-filial').innerText = filial; document.getElementById('inv-id-oculto').value = idInv; document.getElementById('inv-filial-oculto').value = filial; setTimeout(() => document.getElementById('inv-lote').focus(), 100); window.renderHistoricoBipagem(idInv); };
window.voltarTelaInventario = () => { document.getElementById('inv-tela-bipagem').classList.add('hidden'); document.getElementById('inv-tela-selecao').classList.remove('hidden'); window.renderListaInventarios(); };

window.iniciarNovoInventario = (event) => {
    const filial = document.getElementById('inv-nova-filial').value; if (!filial) { alert('Selecione a filial.'); return; }
    const isDirigido = document.getElementById('inv-is-dirigido')?.checked; const textoGtins = document.getElementById('inv-lista-gtins')?.value; let listaLimpa = [];
    if (isDirigido) { if (!textoGtins.trim()) { alert('Cole os GTINs.'); return; } listaLimpa = textoGtins.split(/[\n,;]+/).map(g => g.replace(/[^0-9]/g, '')).filter(g => g.length > 5); if (listaLimpa.length === 0) { alert('GTIN inválido.'); return; } }
    const novoId = 'INV-' + Math.floor(100000 + Math.random() * 900000);

    if (isDirigido) {
        const payload = { tipo: "inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, lote: "SISTEMA", gtin: "LISTA_DIRIGIDA", descricao: JSON.stringify(listaLimpa), quantidade: 0, id_inventario: novoId, status: "ABERTO" };
        sheetsDataRaw.push(payload);
        fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); // Assíncrono em background
    }
    window.abrirTelaBipagem(novoId, filial);
};

window.consultarInventario = () => {
    let busca = document.getElementById('inv-id-busca').value.trim().toUpperCase(); if (!busca) return; if (!busca.startsWith('INV-')) busca = 'INV-' + busca;
    const inventarios = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === busca);
    if (inventarios.length === 0) { alert('Não encontrado.'); return; }
    if (inventarios.some(i => i.status === 'FECHADO')) { alert('Inventário encerrado.'); return; }
    window.abrirTelaBipagem(busca, inventarios[0].filial);
};

window.encerrarInventarioAtual = async (event) => {
    const idInv = document.getElementById('inv-id-oculto').value; const filial = document.getElementById('inv-filial-oculto').value;
    if (!confirm(`Deseja encerrar o ${idInv}?`)) return;
    const btn = event.currentTarget; const txtOriginal = btn.innerHTML; btn.innerHTML = '<i class="w-4 h-4 animate-spin" data-lucide="loader-2"></i> Encerrando...';

    const payload = { tipo: "fechar_inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, id_inventario: idInv, nao_encontrados: [] };

    // Otimista
    sheetsDataRaw.push({ tipo: 'inventario', id_inventario: idInv, status: 'FECHADO', gtin: 'FECHAMENTO', filial: filial });
    window.voltarTelaInventario();

    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); }
    catch (err) { alert('Erro ao fechar no servidor.'); } finally { btn.innerHTML = txtOriginal; }
};

document.getElementById('form-inventario')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const idInv = document.getElementById('inv-id-oculto').value;
    const filial = document.getElementById('inv-filial-oculto').value;
    const inputLote = document.getElementById('inv-lote');
    const inputGtin = document.getElementById('inv-gtin');
    const inputQtd = document.getElementById('inv-qtd');
    const inputCusto = document.getElementById('inv-custo');
    const lote = inputLote.value.trim().toUpperCase();

    // Conversão estrita para Float para evitar NaN
    const custoConvertido = parseFloat(String(inputCusto.value).replace(',', '.')) || 0;
    const qtdConvertida = parseFloat(String(inputQtd.value).replace(',', '.')) || 0;

    const payload = {
        tipo: "inventario",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: filial,
        lote: lote,
        gtin: inputGtin.value,
        descricao: document.getElementById('inv-desc')?.value || "",
        quantidade: qtdConvertida,
        custo: custoConvertido,
        motivo: "Não Identificado", // Motivo padrão agora que foi removido do form
        id_inventario: idInv,
        status: "ABERTO"
    };

    // Submissão otimista
    submitToSheets(null, 'btn-save-inv', '', '', payload, '<i data-lucide="plus-square" class="w-5 h-5 text-gold"></i> Salvar Bipagem');

    // Limpeza de campos
    inputGtin.value = '';
    document.getElementById('inv-desc').value = '';
    inputCusto.value = '';

    const travarQtd = document.getElementById('inv-travar-qtd')?.checked;
    if (travarQtd) {
        inputQtd.value = '1';
    } else {
        inputQtd.value = '';
    }

    // Força o retorno do cursor de forma agressiva após limpar os dados
    setTimeout(() => {
        inputGtin.focus();
    }, 50);

    window.renderHistoricoBipagem(idInv);
});

window.atualizarTotaisTelaInventario = (idInv) => {
    const items = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv && i.gtin !== 'FECHAMENTO');
    const bipagens = items.filter(i => i.gtin !== 'LISTA_DIRIGIDA');

    let totalDesconhecida = 0;
    let totalAdministrativa = 0;

    bipagens.forEach(i => {
        const c = parseFloat(i.custo) || 0;
        const q = parseFloat(i.quantidade) || 0;
        const valorReal = c * q;
        const m = (i.motivo || '').trim();

        if (m === 'Não Identificado' || m === '') {
            totalDesconhecida += valorReal;
        } else {
            totalAdministrativa += valorReal;
        }
    });

    totalDesconhecida = Math.max(0, totalDesconhecida);
    totalAdministrativa = Math.max(0, totalAdministrativa);

    const uiPerdaDesc = document.getElementById('ui-inv-perda-desconhecida');
    if (uiPerdaDesc) uiPerdaDesc.innerText = 'R$ ' + totalDesconhecida.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const uiPerdaAdmin = document.getElementById('ui-inv-perda-admin');
    if (uiPerdaAdmin) uiPerdaAdmin.innerText = 'R$ ' + totalAdministrativa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

window.renderHistoricoBipagem = (idInv) => {
    const divHist = document.getElementById('inv-historico-bipagem'); if (!divHist) return;
    const items = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv && i.gtin !== 'FECHAMENTO');
    const bipagens = items.filter(i => i.gtin !== 'LISTA_DIRIGIDA').reverse();

    window.atualizarTotaisTelaInventario(idInv);

    if (bipagens.length === 0) {
        divHist.innerHTML = '<p class="text-xs text-slate-400 italic">Nenhum item bipado.</p>';
    } else {
        let html = '';
        bipagens.slice(0, 15).forEach(i => {
            const itemEnc = encodeURIComponent(JSON.stringify(i));
            const isEstorno = parseFloat(i.quantidade) < 0;

            // Cálculos financeiros com conversão para Float
            const custoUnit = parseFloat(i.custo) || 0;
            const qtdNum = parseFloat(i.quantidade) || 0;
            const totalPerda = custoUnit * Math.abs(qtdNum);

            const motivoText = !isEstorno ? `
                <span class="text-slate-300 mx-1">|</span> 
                <select class="motivo-select bg-transparent text-slate-500 font-semibold focus:outline-none focus:text-navy cursor-pointer hover:bg-slate-200 rounded transition-colors text-[10px] w-28 truncate" data-item="${itemEnc}">
                    <option value="Não Identificado" ${i.motivo === 'Não Identificado' || !i.motivo ? 'selected' : ''}>Não Identificado</option>
                    <option value="Erro de contagem" ${i.motivo === 'Erro de contagem' ? 'selected' : ''}>Erro de contagem</option>
                    <option value="Erro no recebimento" ${i.motivo === 'Erro no recebimento' ? 'selected' : ''}>Erro no recebimento</option>
                    <option value="Erro no PDV" ${i.motivo === 'Erro no PDV' ? 'selected' : ''}>Erro no PDV</option>
                    <option value="Falta de entrada de Nota Fiscal" ${i.motivo === 'Falta de entrada de Nota Fiscal' ? 'selected' : ''}>Falta de entrada de Nota Fiscal</option>
                </select>
                <span class="motivo-feedback text-[10px] text-emerald font-bold hidden ml-1">Salvando...</span>
            ` : (i.motivo ? `<span class="text-slate-300 mx-1">|</span> <span class="text-slate-500">Motivo: <span class="font-semibold">${i.motivo}</span></span>` : '');

            // Renderiza o botão de lixeira (apenas se não for já um estorno)
            const btnExcluir = isEstorno ? '' : `<button type="button" onclick="window.estornarBipagem('${itemEnc}')" class="text-red-400 hover:text-red-600 p-1.5 rounded transition-colors" title="Cancelar Leitura"><i class="w-4 h-4" data-lucide="trash-2"></i></button>`;
            const corQtd = isEstorno ? 'text-red-600 bg-red-50 border-red-200' : 'text-emerald bg-emerald/10 border-emerald/20';
            const textNome = isEstorno ? 'text-red-600 line-through' : 'text-navy';

            html += `<div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded mb-1">
                <div class="flex flex-col flex-1 min-w-0 pr-2">
                    <span class="text-xs font-bold ${textNome} truncate">${i.descricao || i.gtin}</span>
                    <span class="text-[10px] text-slate-400">Lote: ${i.lote} | EAN: ${i.gtin}</span>
                    <span class="text-[10px] mt-1 flex items-center">
                        <span class="text-slate-500">Custo: R$ ${custoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span class="text-slate-300 mx-1">|</span> 
                        <span class="text-slate-500">Total: <strong class="text-red-500">R$ ${totalPerda.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                        ${motivoText}
                    </span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="text-sm font-black px-2 py-1 rounded border ${corQtd}">${i.quantidade} un</span>
                    ${btnExcluir}
                </div>
            </div>`;
        });
        divHist.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();

        // Adiciona event listeners aos selects de motivo
        const selects = divHist.querySelectorAll('.motivo-select');
        selects.forEach(select => {
            select.addEventListener('change', async (e) => {
                const sel = e.target;
                const itemEncoded = sel.getAttribute('data-item');
                const novoMotivo = sel.value;
                const feedbackSpan = sel.nextElementSibling;

                const item = JSON.parse(decodeURIComponent(itemEncoded));

                // Atualiza localmente
                const idx = sheetsDataRaw.findIndex(i => i.tipo === 'inventario' && i.id_inventario === item.id_inventario && i.gtin === item.gtin && i.quantidade === item.quantidade && i.lote === item.lote);
                if (idx > -1) {
                    sheetsDataRaw[idx].motivo = novoMotivo;
                }

                // Atualiza totais em tempo real
                window.atualizarTotaisTelaInventario(item.id_inventario);

                // Feedback visual de carregamento
                sel.classList.add('border', 'border-emerald', 'text-emerald');
                if (feedbackSpan) {
                    feedbackSpan.innerText = 'Salvando...';
                    feedbackSpan.classList.remove('hidden', 'text-red-600');
                    feedbackSpan.classList.add('text-emerald');
                }

                // Dispara o fetch silenciosamente
                const payload = {
                    tipo: "atualizar_motivo_inventario",
                    id_inventario: item.id_inventario,
                    gtin: item.gtin,
                    quantidade: item.quantidade,
                    lote: item.lote,
                    motivo: novoMotivo,
                    filial: item.filial,
                    empresa: currentUserEmpresa,
                    email: auth && auth.currentUser ? auth.currentUser.email : ''
                };

                try {
                    await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) });
                    if (window.currentUserFilial) sessionStorage.setItem(`lucroData_${window.currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...(window.produtosMestre || [])]));

                    if (feedbackSpan) {
                        feedbackSpan.innerText = 'Salvo!';
                        setTimeout(() => {
                            feedbackSpan.classList.add('hidden');
                            sel.classList.remove('border', 'border-emerald', 'text-emerald');
                        }, 2000);
                    }

                    if (typeof window.renderDashboardInventarioMaster === 'function') window.renderDashboardInventarioMaster();
                } catch (err) {
                    console.warn("Aviso: Falha ao sincronizar com o servidor.");
                    if (feedbackSpan) {
                        feedbackSpan.innerText = 'Erro';
                        feedbackSpan.classList.remove('text-emerald');
                        feedbackSpan.classList.add('text-red-600');
                        setTimeout(() => {
                            feedbackSpan.classList.add('hidden');
                            feedbackSpan.classList.remove('text-red-600');
                            feedbackSpan.classList.add('text-emerald');
                            sel.classList.remove('border', 'border-emerald', 'text-emerald');
                        }, 2000);
                    }
                }
            });
        });
    }
};

// Motor de Estorno (Auditoria Limpa)
window.estornarBipagem = async (itemEncoded) => {
    if (!confirm("Deseja cancelar esta leitura?")) return;
    const item = JSON.parse(decodeURIComponent(itemEncoded));

    // Cria o registro negativo para anular a contagem anterior
    const payload = {
        ...item,
        quantidade: -Math.abs(parseFloat(item.quantidade)),
        descricao: "[ESTORNO] " + (item.descricao || "Produto")
    };

    // Atualiza a tela imediatamente (Otimista)
    sheetsDataRaw.push(payload);
    window.renderHistoricoBipagem(item.id_inventario);

    // Envia o estorno para o Sheets
    try {
        await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) });
        sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre]));
    } catch (e) {
        console.error("Erro ao estornar", e);
    }
};

window.exportarInventarioId = (idInv) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv);
    if (dataToExport.length === 0) { alert("Sem dados."); return; }
    const rows = []; rows.push(["Data do Registo", "Lote/Corredor", "GTIN", "Descrição", "Quantidade", "Status"].join(";"));
    dataToExport.forEach(item => { if (item.gtin === 'LISTA_DIRIGIDA' || item.gtin === 'FECHAMENTO') return; rows.push([`"${item.data_registro || ''}"`, `"${item.lote || 'Sem Lote'}"`, `"${item.gtin || ''}"`, `"${item.descricao || 'Produto'}"`, `${item.quantidade || 0}`, `"Contado"`].join(";")); });
    const csvContent = "\uFEFF" + rows.join("\n"); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.setAttribute("download", `Inventario_${idInv}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
};
window.renderRefugoDashboard = () => {
    const content = document.getElementById('refugo-dashboard-content');
    const empty = document.getElementById('empty-state-refugo');
    const filtroMes = document.getElementById('filtro-mes-refugo')?.value;
    const filtroFilial = document.getElementById('filtro-filial-refugo')?.value;

    if (!filtroMes) return;

    let dados = sheetsDataRaw.filter(i => i.tipo === 'ind_refugo' && i.data_refugo && extrairAnoMes(i.data_refugo) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dados.length === 0) { if (content) content.classList.add('hidden'); if (empty) empty.classList.remove('hidden'); return; }

    if (empty) empty.classList.add('hidden'); if (content) content.classList.remove('hidden');

    let totalQtd = 0; const motivosMap = {}; const maquinasMap = {};
    dados.forEach(item => {
        const qtd = parseLocalFloat(item.quantidade);
        const motivo = item.motivo || 'Outros';
        const maquina = item.maquina || 'Não Informada';

        totalQtd += qtd;
        if (!motivosMap[motivo]) motivosMap[motivo] = 0; motivosMap[motivo] += qtd;
        if (!maquinasMap[maquina]) maquinasMap[maquina] = 0; maquinasMap[maquina] += qtd;
    });

    if (document.getElementById('ui-refugo-total-qtd')) document.getElementById('ui-refugo-total-qtd').innerText = totalQtd.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (document.getElementById('ui-refugo-total-ocorrencias')) document.getElementById('ui-refugo-total-ocorrencias').innerText = dados.length;

    const divMotivos = document.getElementById('refugo-lista-motivos');
    if (divMotivos) {
        const arr = Object.keys(motivosMap).map(k => ({ nome: k, val: motivosMap[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
        divMotivos.innerHTML = arr.map((item, i) => `<div class="flex justify-between items-center p-2 border-b border-slate-100 last:border-0"><span class="text-sm font-medium text-slate-700">${i + 1}. ${item.nome}</span><span class="font-bold text-red-600">${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span></div>`).join('');
    }

    const divMaquinas = document.getElementById('refugo-lista-maquinas');
    if (divMaquinas) {
        const arr = Object.keys(maquinasMap).map(k => ({ nome: k, val: maquinasMap[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
        divMaquinas.innerHTML = arr.map((item, i) => `<div class="flex justify-between items-center p-2 border-b border-slate-100 last:border-0"><span class="text-sm font-medium text-slate-700">${i + 1}. ${item.nome}</span><span class="font-bold text-navy">${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span></div>`).join('');
    }
    if (window.lucide) window.lucide.createIcons();
};

// ==========================================
// 6. LISTENERS DE SUBMISSÃO E FORMS GERAIS
// ==========================================
document.getElementById('btn-export-csv')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('quebra', 'Quebras'); });
document.getElementById('btn-export-csv-docas')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('recebimento', 'Docas'); });
document.getElementById('btn-export-csv-val')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('validade', 'Validades'); });
document.getElementById('btn-export-csv-preco')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('auditoria_preco', 'Auditoria_Precos'); });
document.getElementById('btn-export-csv-caixa')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('caixa_central', 'Caixa_Central'); });
document.getElementById('btn-export-csv-furtos')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('furto', 'Furtos_Evitados'); });
document.getElementById('btn-export-csv-inv')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('inventario', 'Inventario_Completo'); });
document.getElementById('btn-export-csv-refugo')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('ind_refugo', 'Refugo_Sucata'); });

document.getElementById('form-quebras')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const h = new Date(); const mF = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    const payload = { tipo: "quebra", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('q-filial-lancamento')?.value, mes: mF, gtin: document.getElementById('q-gtin')?.value || "", descricao: document.getElementById('q-desc')?.value || "", quantidade: document.getElementById('q-qtd')?.value || "", custo: document.getElementById('q-custo')?.value || "", motivo: document.getElementById('q-motivo')?.value || "" };
    submitToSheets(e.target, 'btn-save-quebra', 'msg-quebra-success', 'msg-quebra-error', payload, 'Enviar para Auditoria');
});

document.getElementById('form-recebimento')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = { tipo: "recebimento", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('r-filial-lancamento')?.value, data_entrega: document.getElementById('r-data')?.value || "", fornecedor: document.getElementById('r-fornecedor')?.value || "", nf: document.getElementById('r-nf')?.value || "", descricao: document.getElementById('r-desc')?.value || "", quantidade: document.getElementById('r-qtd')?.value || "", custo: document.getElementById('r-custo')?.value || "", motivo: document.getElementById('r-motivo')?.value || "", observacoes: document.getElementById('r-obs')?.value || "" };
    submitToSheets(e.target, 'btn-save-recebimento', 'msg-rec-success', 'msg-rec-error', payload, 'Enviar Registo');
});

document.getElementById('form-validade')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = { tipo: "validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('v-filial-lancamento')?.value, gtin: document.getElementById('v-gtin')?.value || "", descricao: document.getElementById('v-desc')?.value || "", categoria: document.getElementById('v-cat')?.value || "", quantidade: document.getElementById('v-qtd')?.value || "", custo: document.getElementById('v-custo')?.value || "", data_validade: document.getElementById('v-data')?.value || "" };
    submitToSheets(e.target, 'btn-save-validade', 'msg-val-success', 'msg-val-error', payload, 'Inserir no Radar');
});

document.getElementById('form-auditoria-preco')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;

    // 1. Memoriza a data atual antes de o formulário ser limpo
    const inputData = document.getElementById('p-data');
    const dataSalva = inputData ? inputData.value : "";

    const payload = {
        tipo: "auditoria_preco",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: document.getElementById('p-filial-lancamento')?.value,
        data_auditoria: document.getElementById('p-data')?.value,
        gtin: document.getElementById('p-gtin')?.value || "",
        descricao: document.getElementById('p-desc')?.value || "",
        preco_sistema: document.getElementById('p-sistema')?.value || "",
        preco_gondola: document.getElementById('p-gondola')?.value || "",
        sem_preco: document.getElementById('p-sem-preco')?.value || "NÃO"
    };

    await submitToSheets(e.target, 'btn-save-preco', 'msg-preco-success', 'msg-preco-error', payload, 'Enviar Auditoria');

    // 2. Restaura a data salva e atira o cursor diretamente para o campo GTIN
    if (inputData) inputData.value = dataSalva;
    setTimeout(() => {
        const inputGtin = document.getElementById('p-gtin');
        if (inputGtin) inputGtin.focus();
    }, 100);
});

document.getElementById('form-caixa-central')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = { tipo: "caixa_central", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('c-filial-lancamento')?.value, data_auditoria: document.getElementById('c-data')?.value || "", operador: document.getElementById('c-operador')?.value || "", tipo_divergencia: document.getElementById('c-tipo')?.value || "", valor_falta: document.getElementById('c-valor')?.value || "", observacoes: document.getElementById('c-obs')?.value || "" };
    submitToSheets(e.target, 'btn-save-caixa', 'msg-caixa-success', 'msg-caixa-error', payload, 'Registrar Falta');
});

document.getElementById('btn-add-prod')?.addEventListener('click', () => {
    const n = document.getElementById('f-prod-nome').value.trim(); const q = parseInt(document.getElementById('f-prod-qtd').value) || 0; const p = parseFloat(document.getElementById('f-prod-preco').value.replace(',', '.')) || 0;
    if (!n || q <= 0 || p < 0) { alert("Preencha dados válidos."); return; }
    produtosFurto.push({ nome: n, qtd: q, preco: p }); document.getElementById('f-prod-nome').value = ''; document.getElementById('f-prod-qtd').value = ''; document.getElementById('f-prod-preco').value = '';
    const lP = document.getElementById('f-lista-produtos'); if (lP) lP.innerHTML += `<li class="flex justify-between items-center p-2 bg-white border border-slate-200 rounded mb-1 text-xs"><span class="font-bold text-navy truncate flex-1">${n}</span><span class="text-slate-500 w-16 text-center">${q} un</span><span class="text-red-600 font-bold w-24 text-right">R$ ${(q * p).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></li>`;
});

document.getElementById('form-furtos')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return; if (produtosFurto.length === 0) { alert("Adicione produtos primeiro."); return; }

    // Calcula o subtotal financeiro para os gráficos do dashboard lerem
    let subtotalCalculado = 0;
    produtosFurto.forEach(p => subtotalCalculado += (p.qtd * p.preco));

    const payload = {
        tipo: "furto",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: document.getElementById('f-filial')?.value,
        data_ocorrencia: document.getElementById('f-data')?.value || "",
        genero: document.getElementById('f-genero')?.value || "",
        idade: document.getElementById('f-idade')?.value || "",
        abordagem: document.getElementById('f-abordagem')?.value || "",
        local: document.getElementById('f-local')?.value || "",
        descricao: document.getElementById('f-desc')?.value || "",
        subtotal: subtotalCalculado,
        produtos: produtosFurto // <-- REMOVIDO O JSON.stringify. Agora volta a ser uma lista pura!
    };

    await submitToSheets(e.target, 'btn-save-furto', 'msg-furto-success', 'msg-furto-error', payload, 'Registrar Sinistro');
    produtosFurto = []; const lP = document.getElementById('f-lista-produtos'); if (lP) lP.innerHTML = '';
});

document.getElementById('form-tarefas')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = { tipo: "tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('t-filial').value, titulo: document.getElementById('t-titulo').value, prazo: document.getElementById('t-prazo').value, status: 'PENDENTE' };
    await submitToSheets(e.target, 'btn-save-tar', 'msg-tar-success', '', payload, 'Criar Demanda');
});

document.getElementById('form-auditoria')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser || !itemEmAuditoria) return;

    // CORREÇÃO: Usar a filial exata do item auditado (itemEmAuditoria.filial) em vez da lista global
    const payload = {
        tipo: "atualizar_validade",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: itemEmAuditoria.filial,
        gtin: itemEmAuditoria.gtin,
        descricao: itemEmAuditoria.descricao,
        data_validade: itemEmAuditoria.data_validade,
        quantidade: document.getElementById('modal-nova-qtd').value.replace(',', '.')
    };

    await submitToSheets(null, 'btn-save-auditoria', '', '', payload, 'Atualizar Posição');
    document.getElementById('modal-auditoria').classList.add('hidden');
});

document.getElementById('form-ind-refugo')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = {
        tipo: "ind_refugo",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: document.getElementById('ir-filial').value,
        data_refugo: document.getElementById('ir-data').value,
        turno: document.getElementById('ir-turno').value,
        maquina: document.getElementById('ir-maquina').value,
        material: document.getElementById('ir-material').value,
        quantidade: document.getElementById('ir-qtd').value,
        unidade: document.getElementById('ir-un').value,
        motivo: document.getElementById('ir-motivo').value
    };
    await submitToSheets(e.target, 'btn-save-refugo', 'msg-ref-success', '', payload, 'Registrar Perda Industrial');
});

// ==========================================
// 7. VIEWS E NAVEGAÇÃO GERAL
// ==========================================
window.showView = (vN) => {
    ['portal-cliente', 'site-principal', 'auth-view', 'view-admin', 'view-client'].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.classList.remove('flex'); } });
    if (vN === 'site-principal') { const site = document.getElementById('site-principal'); if (site) site.classList.remove('hidden'); }
    else {
        const portal = document.getElementById('portal-cliente'); if (portal) { portal.classList.remove('hidden'); portal.classList.add('flex'); }
        if (vN === 'login') { const auth = document.getElementById('auth-view'); if (auth) { auth.classList.remove('hidden'); auth.classList.add('flex'); } }
        if (vN === 'admin') { const admin = document.getElementById('view-admin'); if (admin) { admin.classList.remove('hidden'); admin.classList.add('flex'); } }
        if (vN === 'client') { const client = document.getElementById('view-client'); if (client) { client.classList.remove('hidden'); client.classList.add('flex'); } if (window.mudarEstadoSegmento) window.mudarEstadoSegmento('hub'); }
    }
    window.scrollTo(0, 0);
};

// Motor de limpeza das abas de Varejo
window.unselectAllTabs = () => {
    ['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-white text-slate-500 border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm hover:shadow-md hover:border-navy hover:text-navy transition-all gap-1";
    });
    ['wrapper-tab-dash', 'wrapper-tab-form', 'wrapper-tab-recebimento', 'wrapper-tab-validade', 'wrapper-tab-furtos', 'wrapper-tab-preco', 'wrapper-tab-caixa', 'wrapper-tab-inv', 'wrapper-tab-tar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
};

// Motor de limpeza das abas da Indústria (Novos IDs)
window.unselectAllIndTabs = () => {
    ['btn-tab-dash-ind', 'btn-tab-prod', 'btn-tab-mp', 'btn-tab-qualidade', 'btn-tab-inv-ind', 'btn-tab-contagem-ind'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md";
    });
    ['wrapper-tab-dash-ind', 'wrapper-tab-prod', 'wrapper-tab-mp', 'wrapper-tab-qualidade', 'wrapper-tab-inv-ind', 'wrapper-tab-contagem-ind'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
};

// Gerenciador de Segmentos (Varejo / Indústria / Hub)
window.mudarEstadoSegmento = (est) => {
    const vc = document.getElementById('view-client');
    if (vc) {
        vc.classList.remove('estado-hub', 'estado-varejo', 'estado-industria');
        vc.classList.add('estado-' + est);
    }

    const cS = document.getElementById('container-segmentos');
    const mV = document.getElementById('menu-abas');
    const mI = document.getElementById('menu-abas-industria');

    if (est === 'hub') {
        if (mV) mV.classList.add('hidden');
        if (mI) mI.classList.add('hidden');
        if (cS) cS.classList.remove('hidden');
        window.unselectAllTabs();
        window.unselectAllIndTabs();
    }
    else if (est === 'varejo') {
        if (cS) cS.classList.add('hidden');
        if (mI) mI.classList.add('hidden');
        if (mV) mV.classList.remove('hidden');
        document.getElementById('btn-tab-dash')?.click();
    }
    else if (est === 'industria') {
        if (cS) cS.classList.add('hidden');
        if (mV) mV.classList.add('hidden');
        if (mI) mI.classList.remove('hidden');
        document.getElementById('btn-tab-dash-ind')?.click();
    }
};

// Eventos de clique para os botões do Varejo
['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => {
        window.unselectAllTabs();
        b.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center shadow-md transition-all gap-1";
        const map = { 'btn-tab-dash': 'wrapper-tab-dash', 'btn-tab-form': 'wrapper-tab-form', 'btn-tab-rec': 'wrapper-tab-recebimento', 'btn-tab-val': 'wrapper-tab-validade', 'btn-tab-furtos': 'wrapper-tab-furtos', 'btn-tab-preco': 'wrapper-tab-preco', 'btn-tab-caixa': 'wrapper-tab-caixa', 'btn-tab-inv': 'wrapper-tab-inv', 'btn-tab-tar': 'wrapper-tab-tar' };
        document.getElementById(map[id])?.classList.remove('hidden');
    });
});

// Eventos de clique para os botões da Indústria
['btn-tab-dash-ind', 'btn-tab-prod', 'btn-tab-mp', 'btn-tab-qualidade', 'btn-tab-inv-ind', 'btn-tab-contagem-ind'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => {
        window.unselectAllIndTabs();
        b.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
        const map = {
            'btn-tab-dash-ind': 'wrapper-tab-dash-ind',
            'btn-tab-prod': 'wrapper-tab-prod',
            'btn-tab-mp': 'wrapper-tab-mp',
            'btn-tab-qualidade': 'wrapper-tab-qualidade',
            'btn-tab-inv-ind': 'wrapper-tab-inv-ind',
            'btn-tab-contagem-ind': 'wrapper-tab-contagem-ind'
        };
        document.getElementById(map[id])?.classList.remove('hidden');
    });
});
// Navegação das Abas do Painel Admin (Consultor)
const btnAdminUsers = document.getElementById('btn-admin-tab-users');
const btnAdminKpi = document.getElementById('btn-admin-tab-kpi');
const btnAdminDiag = document.getElementById('btn-admin-tab-diag');
const wrapAdminUsers = document.getElementById('admin-wrapper-tab-users');
const wrapAdminKpi = document.getElementById('admin-wrapper-tab-kpi');
const wrapAdminDiag = document.getElementById('admin-wrapper-tab-diag');

const unselectAdmin = () => {
    [btnAdminUsers, btnAdminKpi, btnAdminDiag].forEach(b => {
        if (b) b.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md";
    });
    [wrapAdminUsers, wrapAdminKpi, wrapAdminDiag].forEach(w => w?.classList.add('hidden'));
};

btnAdminUsers?.addEventListener('click', () => { unselectAdmin(); btnAdminUsers.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md"; wrapAdminUsers.classList.remove('hidden'); });
btnAdminKpi?.addEventListener('click', () => { unselectAdmin(); btnAdminKpi.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md"; wrapAdminKpi.classList.remove('hidden'); });
btnAdminDiag?.addEventListener('click', () => { unselectAdmin(); btnAdminDiag.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md"; wrapAdminDiag.classList.remove('hidden'); });

// ==========================================
// 8. AUTENTICAÇÃO E HIERARQUIA
// ==========================================
const lF = document.getElementById('login-form');
if (lF) lF.addEventListener('submit', async (e) => { e.preventDefault(); document.getElementById('login-error-box')?.classList.add('hidden'); document.getElementById('login-loading')?.classList.remove('hidden'); try { await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (er) { document.getElementById('login-loading')?.classList.add('hidden'); document.getElementById('login-error-box')?.classList.remove('hidden'); document.getElementById('login-error-text').innerText = "Credenciais inválidas."; } });

document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', () => {
    signOut(auth).then(() => {
        sessionStorage.clear();
        localStorage.clear();
        window.location.reload();
    }).catch(err => console.error("Erro no logout:", err));
}));

onAuthStateChanged(auth, async (user) => {
    const loadBox = document.getElementById('login-loading'); if (loadBox) loadBox.classList.add('hidden');
    if (user) {
        if (document.getElementById('top-user-email')) document.getElementById('top-user-email').innerText = user.email;
        if (user.email === 'leandro@lucroseguro.com.br' || user.email.includes('leandro')) {
            currentUserRole = 'admin';
            currentUserEmpresa = ''; // <-- INJETE ESTA LINHA PARA LIMPAR O FILTRO
            window.showView('admin');
            window.fetchSheetsDataComHierarquia();
            if (typeof window.carregarFiltrosKpi === 'function') window.carregarFiltrosKpi();
        }
        else {
            try {
                const docSnap = await getDoc(doc(db, 'users_permissions', user.email));
                if (docSnap.exists()) {
                    const p = docSnap.data(); currentUserEmpresa = p.company_name; currentUserFilial = p.unit_name; currentUserRole = p.role || 'operacional';
                    // Suporte a múltiplas filiais (separadas por vírgula no Firebase)
                    const listaFiliais = currentUserFilial.split(',').map(f => f.trim());
                    let optionsForm = ''; listaFiliais.forEach(f => optionsForm += `<option value="${f}">${f}</option>`);
                    let optionsFiltro = listaFiliais.length > 1 ? `<option value="todas">Todas as Minhas Lojas</option>` : '';
                    listaFiliais.forEach(f => optionsFiltro += `<option value="${f}">${f}</option>`);

                    ['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial', 'ir-filial', 'ip-filial', 'iq-filial', 'ia-filial', 'inv-ind-nova-filial'].forEach(id => { const el = document.getElementById(id); if (el) { el.innerHTML = optionsForm; el.value = listaFiliais[0]; } });
                    ['filtro-filial-quebra', 'filtro-filial-docas', 'filtro-filial-validade', 'filtro-filial-furtos', 'filtro-filial-preco', 'filtro-filial-caixa', 'filtro-filial-inv', 'filtro-filial-tar', 'filtro-filial-refugo', 'filtro-filial-paradas', 'filtro-filial-qualidade', 'filtro-filial-almoxarifado', 'filtro-filial-contagem-ind'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.innerHTML = optionsFiltro;
                            el.value = listaFiliais.length > 1 ? 'todas' : listaFiliais[0];
                            // Ordem visual: Mostra o filtro se tiver mais que 1 loja, oculta se for só 1
                            if (listaFiliais.length > 1) { el.classList.remove('hidden'); } else { el.classList.add('hidden'); }
                        }
                    });
                    window.showView('client'); window.fetchSheetsDataComHierarquia();
                } else { signOut(auth); }
            } catch (e) { signOut(auth); }
        }
    } else { window.showView('site-principal'); }
});

if (window.location.hash === '#login') window.showView('login'); else window.showView('site-principal');

// ==========================================
// 9. MASTER DATA (AUTOCOMPLETAR GTIN)
// ==========================================
const autocompletarPorGtin = (gtin, inputsAlvo, filialId) => {
    const busca = String(gtin).replace(/[^0-9]/g, '');

    // 1. Limpa os campos automaticamente se o usuário apagar o GTIN
    if (busca.length === 0) {
        if (inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) document.getElementById(inputsAlvo.desc).value = '';
        if (inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) document.getElementById(inputsAlvo.custo).value = '';
        if (inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) document.getElementById(inputsAlvo.preco).value = '';
        return;
    }

    // 2. Descobre qual filial está selecionada no formulário atual
    const filialSelecionada = document.getElementById(filialId)?.value || "";

    // 3. Procura o produto respeitando a Filial exata. 
    // (Bônus: Se a coluna Filial na planilha estiver vazia, o sistema entende que o produto é Global/Serve para todas as lojas).
    const produto = produtosMestre.find(p => p.gtin === busca && (String(p.filial) === String(filialSelecionada) || !p.filial || String(p.filial).trim() === ""));

    if (produto) {
        if (inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) {
            document.getElementById(inputsAlvo.desc).value = produto.descricao || '';
        }
        if (inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) {
            const custoNum = parseFloat(String(produto.custo || 0).replace(',', '.'));
            document.getElementById(inputsAlvo.custo).value = custoNum > 0 ? custoNum.toFixed(2) : '';
        }
        if (inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) {
            const precoNum = parseFloat(String(produto.preco || 0).replace(',', '.'));
            document.getElementById(inputsAlvo.preco).value = precoNum > 0 ? precoNum.toFixed(2) : '';
        }
    } else {
        // Regra 2: Caso não encontre o produto, limpa os campos para digitação manual
        if (inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) document.getElementById(inputsAlvo.desc).value = '';
        if (inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) document.getElementById(inputsAlvo.custo).value = '';
        if (inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) document.getElementById(inputsAlvo.preco).value = '';
    }
};

// Liga o "espião" a cada campo de GTIN, ensinando-lhe onde está a caixa de filial correspondente
[
    { gtinId: 'inv-gtin', filialId: 'inv-filial-oculto', alvos: { desc: 'inv-desc', custo: 'inv-custo' } },
    { gtinId: 'q-gtin', filialId: 'q-filial-lancamento', alvos: { desc: 'q-desc', custo: 'q-custo' } },
    { gtinId: 'p-gtin', filialId: 'p-filial-lancamento', alvos: { desc: 'p-desc', preco: 'p-sistema' } },
    { gtinId: 'v-gtin', filialId: 'v-filial-lancamento', alvos: { desc: 'v-desc', custo: 'v-custo' } }
].forEach(mapa => {
    const inputEan = document.getElementById(mapa.gtinId);
    if (inputEan) {
        // O evento 'input' atua a cada letra digitada ou apagada, tornando a limpeza instantânea
        inputEan.addEventListener('input', (e) => autocompletarPorGtin(e.target.value, mapa.alvos, mapa.filialId));
        inputEan.addEventListener('blur', (e) => autocompletarPorGtin(e.target.value, mapa.alvos, mapa.filialId));
    }
});
// ==========================================
// 10. MOTOR DO PAINEL ADMIN (VISÃO DE CONSULTOR)
// ==========================================
document.getElementById('btn-switch-client')?.addEventListener('click', async () => {
    // 1. Pega o e-mail que o consultor digitou no campo
    const emailAlvo = document.getElementById('input-client-email')?.value.trim();

    if (!emailAlvo) {
        alert('Por favor, informe o e-mail do cliente na Gaveta de Dados antes de ver os gráficos.');
        return;
    }

    const btn = document.getElementById('btn-switch-client');
    const txtOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="w-4 h-4 animate-spin" data-lucide="loader-2"></i> A carregar...';

    try {
        // 2. Vai ao Firebase descobrir a empresa e filial deste e-mail
        const docSnap = await getDoc(doc(db, 'users_permissions', emailAlvo));

        if (docSnap.exists()) {
            const p = docSnap.data();

            // 3. Muda as variáveis globais para a identidade do cliente
            currentUserEmpresa = p.company_name;
            currentUserFilial = p.unit_name;
            currentUserRole = p.role || 'operacional';

            // =====================================================================
            // NOVA LÓGICA: Suporte a múltiplas filiais no modo consultor
            // =====================================================================
            const listaFiliais = currentUserFilial.split(',').map(f => f.trim());
            let optionsForm = '';
            listaFiliais.forEach(f => optionsForm += `<option value="${f}">${f}</option>`);

            let optionsFiltro = listaFiliais.length > 1 ? `<option value="todas">Todas as Minhas Lojas</option>` : '';
            listaFiliais.forEach(f => optionsFiltro += `<option value="${f}">${f}</option>`);

            ['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial', 'ir-filial', 'ip-filial', 'iq-filial', 'ia-filial', 'inv-ind-nova-filial'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.innerHTML = optionsForm; el.value = listaFiliais[0]; }
            });

            ['filtro-filial-quebra', 'filtro-filial-docas', 'filtro-filial-validade', 'filtro-filial-furtos', 'filtro-filial-preco', 'filtro-filial-caixa', 'filtro-filial-inv', 'filtro-filial-tar', 'filtro-filial-refugo', 'filtro-filial-paradas', 'filtro-filial-qualidade', 'filtro-filial-almoxarifado', 'filtro-filial-contagem-ind'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.innerHTML = optionsFiltro; el.value = listaFiliais.length > 1 ? 'todas' : listaFiliais[0]; }
            });
            // =====================================================================

            // 4. Mostra o botão dourado "Visão Consultor" para você poder voltar
            const btnVoltarAdmin = document.getElementById('btn-switch-admin');
            if (btnVoltarAdmin) {
                btnVoltarAdmin.style.display = 'block';
                btnVoltarAdmin.onclick = () => {
                    window.showView('admin');
                    btnVoltarAdmin.style.display = 'none';
                    document.getElementById('top-user-email').innerText = auth.currentUser.email;
                };
            }

            // Identifica no cabeçalho que você está a espiar a conta do cliente
            const topUser = document.getElementById('top-user-email');
            if (topUser) topUser.innerText = emailAlvo + " (Visão Consultor)";

            // 5. Muda para a tela do cliente e força o download dos dados dele
            window.showView('client');
            window.fetchSheetsDataComHierarquia();

        } else {
            alert('E-mail não encontrado na base de dados. Verifique a ortografia.');
        }
    } catch (error) {
        alert('Erro ao ligar à base de dados de permissões.');
        console.error(error);
    } finally {
        btn.innerHTML = txtOriginal;
        if (window.lucide) window.lucide.createIcons();
    }
});
// ==========================================
// 11. CADASTRO DE CLIENTES E MÚLTIPLAS LOJAS (ADMIN)
// ==========================================
document.getElementById('form-gestao-clientes')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = document.getElementById('btn-save-gc');
    const msgSuccess = document.getElementById('msg-gc-success');
    const msgError = document.getElementById('msg-gc-error');
    const txtError = document.getElementById('txt-gc-error');
    const txtOriginal = btnSubmit.innerHTML;

    // Feedback visual
    btnSubmit.innerHTML = '<i class="w-5 h-5 animate-spin" data-lucide="loader-2"></i> Salvando...';
    btnSubmit.disabled = true;
    if (msgSuccess) msgSuccess.classList.add('hidden');
    if (msgError) msgError.classList.add('hidden');

    // Captura os dados digitados
    const email = document.getElementById('gc-email').value.trim().toLowerCase();
    const senha = document.getElementById('gc-senha').value; // <-- Captura da Senha adicionada
    const empresa = document.getElementById('gc-empresa').value.trim();
    const filiaisRaw = document.getElementById('gc-filial').value;
    const role = document.getElementById('gc-role').value;

    const filiaisLimpatas = filiaisRaw.split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0)
        .join(', ');

    try {
        // PASSO 1: Criar no Authentication (Usando App Secundário para não derrubar o Admin)
        const appNome = "SecondaryApp_" + Date.now();
        const secondaryApp = initializeApp(firebaseConfig, appNome);
        const secondaryAuth = getAuth(secondaryApp);

        // Cria a conta do cliente efetivamente
        await createUserWithEmailAndPassword(secondaryAuth, email, senha);
        // Desloga a conta nova do fundo para não interferir com a tela atual
        await signOut(secondaryAuth);

        // PASSO 2: Grava as permissões e filiais no Firestore Database
        await setDoc(doc(db, "users_permissions", email), {
            email: email,
            company_name: empresa,
            unit_name: filiaisLimpatas,
            role: role,
            segment: "varejo",
            updatedAt: serverTimestamp()
        });

        if (msgSuccess) msgSuccess.classList.remove('hidden');
        e.target.reset(); // Limpa o formulário

    } catch (error) {
        console.error("Erro ao vincular usuário:", error);
        if (msgError) {
            // Tradutor de erros para o painel
            if (error.code === 'auth/email-already-in-use') {
                txtError.innerText = "Este e-mail já está registado no sistema.";
            } else if (error.code === 'auth/weak-password') {
                txtError.innerText = "A senha deve ter pelo menos 6 caracteres.";
            } else {
                txtError.innerText = "Erro ao gravar. Verifique os dados.";
            }
            msgError.classList.remove('hidden');
        }
    } finally {
        btnSubmit.innerHTML = txtOriginal;
        btnSubmit.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }
});
// ==========================================
// 12. MOTOR DE GESTÃO DE EMPRESAS E LISTA SUSPENSA
// ==========================================

// Função para buscar as empresas no Firebase e preencher o select
window.carregarEmpresas = async () => {
    const selectEmpresa = document.getElementById('gc-empresa');
    if (!selectEmpresa) return;

    try {
        const querySnapshot = await getDocs(collection(db, "empresas"));
        let options = '<option value="">Selecione a Empresa Matriz...</option>';

        querySnapshot.forEach((docSnap) => {
            // Usa o ID do documento como o nome da empresa
            options += `<option value="${docSnap.id}">${docSnap.id}</option>`;
        });

        selectEmpresa.innerHTML = options;
    } catch (error) {
        console.error("Erro ao carregar empresas do Firebase:", error);
        selectEmpresa.innerHTML = '<option value="">Erro ao carregar</option>';
    }
};

// Dispara a busca das empresas automaticamente quando você (Admin) fizer o login
onAuthStateChanged(auth, (user) => {
    if (user && (user.email === 'leandro@lucroseguro.com.br' || user.email.includes('leandro'))) {
        window.carregarEmpresas();
    }
});

// Faz o botão "Criar Empresa" funcionar e atualizar a lista instantaneamente
document.getElementById('form-nova-empresa')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nomeEmpresa = document.getElementById('ne-nome').value.trim();
    const btn = document.getElementById('btn-save-empresa');
    const msgSuccess = document.getElementById('msg-ne-success');

    if (!nomeEmpresa) return;
    const txtOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="w-5 h-5 animate-spin" data-lucide="loader-2"></i> Criando...';

    try {
        // Grava a nova empresa na coleção 'empresas' do Firebase
        await setDoc(doc(db, "empresas", nomeEmpresa), {
            nome: nomeEmpresa,
            createdAt: serverTimestamp()
        });

        if (msgSuccess) {
            msgSuccess.classList.remove('hidden');
            setTimeout(() => msgSuccess.classList.add('hidden'), 5000);
        }
        e.target.reset(); // Limpa o formulário

        // Recarrega a lista de empresas para que ela apareça na hora no Vincular Usuário
        window.carregarEmpresas();

    } catch (error) {
        alert("Erro ao criar empresa: " + error.message);
    } finally {
        btn.innerHTML = txtOriginal;
        if (window.lucide) window.lucide.createIcons();
    }
}); // <-- AQUI É O FECHAMENTO CORRETO DO FORM NOVA EMPRESA. O QUE VEM ABAIXO ESTÁ LIVRE!

// ==========================================
// 13. MÓDULO INDÚSTRIA: PARADAS (OEE)
// ==========================================

// Botão de Exportação CSV
document.getElementById('btn-export-csv-paradas')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('ind_paradas', 'Paradas_Maquina'); });

// Gravação de Paradas
document.getElementById('form-ind-paradas')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = {
        tipo: "ind_paradas",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: document.getElementById('ip-filial').value,
        data_parada: document.getElementById('ip-data').value,
        turno: document.getElementById('ip-turno').value,
        maquina: document.getElementById('ip-maquina').value,
        motivo: document.getElementById('ip-motivo').value,
        tempo: document.getElementById('ip-tempo').value,
        custo_hora: document.getElementById('ip-custo').value,
        observacoes: document.getElementById('ip-obs').value
    };
    await submitToSheets(e.target, 'btn-save-paradas', 'msg-paradas-success', '', payload, 'Registrar Tempo Inativo');
});

// Renderização do Dashboard de Paradas
window.renderParadasDashboard = () => {
    const content = document.getElementById('paradas-dashboard-content');
    const empty = document.getElementById('empty-state-paradas');
    const filtroMes = document.getElementById('filtro-mes-paradas')?.value;
    const filtroFilial = document.getElementById('filtro-filial-paradas')?.value;

    if (!filtroMes) return;

    let dados = sheetsDataRaw.filter(i => i.tipo === 'ind_paradas' && i.data_parada && extrairAnoMes(i.data_parada) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dados.length === 0) { if (content) content.classList.add('hidden'); if (empty) empty.classList.remove('hidden'); return; }

    if (empty) empty.classList.add('hidden'); if (content) content.classList.remove('hidden');

    let totalTempo = 0; let totalRs = 0; const motivosMap = {};
    dados.forEach(item => {
        const tempo = parseLocalFloat(item.tempo);
        const custoHora = parseLocalFloat(item.custo_hora) || 0;

        // Regra de OEE Financeiro: (Minutos / 60) * Custo da Hora
        const impactoFinanceiro = (tempo / 60) * custoHora;

        const motivo = item.motivo || 'Outros';

        totalTempo += tempo;
        totalRs += impactoFinanceiro;

        // Agora o gráfico de motivos ranqueia pelo DINHEIRO perdido, não apenas minutos
        if (!motivosMap[motivo]) motivosMap[motivo] = 0;
        motivosMap[motivo] += impactoFinanceiro;
    });

    if (document.getElementById('ui-paradas-total-rs')) document.getElementById('ui-paradas-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (document.getElementById('ui-paradas-total-min')) document.getElementById('ui-paradas-total-min').innerHTML = `${totalTempo}<span class="text-lg font-medium text-orange-500 ml-1">Min</span>`;
    if (document.getElementById('ui-paradas-total-ocorrencias')) document.getElementById('ui-paradas-total-ocorrencias').innerText = dados.length;

    const divMotivos = document.getElementById('paradas-lista-motivos');
    if (divMotivos) {
        const arr = Object.keys(motivosMap).map(k => ({ nome: k, val: motivosMap[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
        divMotivos.innerHTML = arr.map((item, i) => `<div class="flex justify-between items-center p-2 border-b border-slate-100 last:border-0"><span class="text-sm font-medium text-slate-700">${i + 1}. ${item.nome}</span><span class="font-bold text-red-600">R$ ${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`).join('');
    }
    if (window.lucide) window.lucide.createIcons();
};
// ==========================================
// 14. MÓDULO INDÚSTRIA: CONTROLE DE QUALIDADE
// ==========================================

// Botão de Exportação CSV
document.getElementById('btn-export-csv-qualidade')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('ind_qualidade', 'Controle_Qualidade'); });

// Gravação de Qualidade
document.getElementById('form-ind-qualidade')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = {
        tipo: "ind_qualidade",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: document.getElementById('iq-filial').value,
        data_qualidade: document.getElementById('iq-data').value,
        turno: document.getElementById('iq-turno').value,
        lote: document.getElementById('iq-lote').value,
        produto: document.getElementById('iq-produto').value,
        motivo: document.getElementById('iq-motivo').value,
        qtd: document.getElementById('iq-qtd').value,
        horas: document.getElementById('iq-horas').value,
        custo_hora: document.getElementById('iq-custo-hora').value,
        custo_extra: document.getElementById('iq-custo-extra').value || "0"
    };
    await submitToSheets(e.target, 'btn-save-qualidade', 'msg-qualidade-success', '', payload, 'Registrar Custo de Retrabalho');
});

// Renderização do Dashboard de Qualidade
window.renderQualidadeDashboard = () => {
    const content = document.getElementById('qualidade-dashboard-content');
    const empty = document.getElementById('empty-state-qualidade');
    const filtroMes = document.getElementById('filtro-mes-qualidade')?.value;
    const filtroFilial = document.getElementById('filtro-filial-qualidade')?.value;

    if (!filtroMes) return;

    let dados = sheetsDataRaw.filter(i => i.tipo === 'ind_qualidade' && i.data_qualidade && extrairAnoMes(i.data_qualidade) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dados.length === 0) { if (content) content.classList.add('hidden'); if (empty) empty.classList.remove('hidden'); return; }

    if (empty) empty.classList.add('hidden'); if (content) content.classList.remove('hidden');

    let totalCusto = 0; let totalQtd = 0; const motivosMap = {};
    dados.forEach(item => {
        const qtd = parseLocalFloat(item.qtd);
        const horas = parseLocalFloat(item.horas);
        const custoHora = parseLocalFloat(item.custo_hora);
        const custoExtra = parseLocalFloat(item.custo_extra);

        // Matemática da Controladoria: Horas * Custo da Hora + Gastos Materiais
        const impactoFinanceiro = (horas * custoHora) + custoExtra;
        const motivo = item.motivo || 'Outros';

        totalQtd += qtd;
        totalCusto += impactoFinanceiro;

        if (!motivosMap[motivo]) motivosMap[motivo] = 0;
        motivosMap[motivo] += impactoFinanceiro;
    });

    if (document.getElementById('ui-qualidade-total-rs')) document.getElementById('ui-qualidade-total-rs').innerText = 'R$ ' + totalCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (document.getElementById('ui-qualidade-total-qtd')) document.getElementById('ui-qualidade-total-qtd').innerText = totalQtd.toLocaleString('pt-BR');
    if (document.getElementById('ui-qualidade-total-ocorrencias')) document.getElementById('ui-qualidade-total-ocorrencias').innerText = dados.length;

    const divMotivos = document.getElementById('qualidade-lista-motivos');
    if (divMotivos) {
        const arr = Object.keys(motivosMap).map(k => ({ nome: k, val: motivosMap[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
        divMotivos.innerHTML = arr.map((item, i) => `<div class="flex justify-between items-center p-2 border-b border-slate-100 last:border-0"><span class="text-sm font-medium text-slate-700">${i + 1}. ${item.nome}</span><span class="font-bold text-red-600">R$ ${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`).join('');
    }
    if (window.lucide) window.lucide.createIcons();
};
// ==========================================
// 15. MÓDULO INDÚSTRIA: ALMOXARIFADO
// ==========================================

// Botão de Exportação CSV
document.getElementById('btn-export-csv-almoxarifado')?.addEventListener('click', (e) => { e.preventDefault(); window.exportDataToCSV('ind_almoxarifado', 'Almoxarifado_Auditoria'); });

// Gravação
document.getElementById('form-ind-almoxarifado')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;

    // Calcula a divergência na hora: Físico menos Sistema
    const qtdSistema = parseLocalFloat(document.getElementById('ia-sistema').value);
    const qtdFisica = parseLocalFloat(document.getElementById('ia-fisico').value);
    const divergencia = qtdFisica - qtdSistema;
    const custoUnit = parseLocalFloat(document.getElementById('ia-custo').value);

    // Impacto financeiro absoluto
    const impacto = Math.abs(divergencia) * custoUnit;

    const payload = {
        tipo: "ind_almoxarifado",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: document.getElementById('ia-filial').value,
        data_auditoria: document.getElementById('ia-data').value,
        turno: document.getElementById('ia-turno').value,
        material: document.getElementById('ia-material').value,
        qtd_sistema: qtdSistema,
        qtd_fisica: qtdFisica,
        divergencia: divergencia,
        custo_unit: custoUnit,
        impacto: impacto,
        motivo: document.getElementById('ia-motivo').value
    };
    await submitToSheets(e.target, 'btn-save-almoxarifado', 'msg-almoxarifado-success', '', payload, 'Registrar Auditoria no Estoque');
});

// Renderização do Dashboard
window.renderAlmoxarifadoDashboard = () => {
    const content = document.getElementById('almoxarifado-dashboard-content');
    const empty = document.getElementById('empty-state-almoxarifado');
    const filtroMes = document.getElementById('filtro-mes-almoxarifado')?.value;
    const filtroFilial = document.getElementById('filtro-filial-almoxarifado')?.value;

    if (!filtroMes) return;

    let dados = sheetsDataRaw.filter(i => i.tipo === 'ind_almoxarifado' && i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dados = dados.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if (dados.length === 0) { if (content) content.classList.add('hidden'); if (empty) empty.classList.remove('hidden'); return; }
    if (empty) empty.classList.add('hidden'); if (content) content.classList.remove('hidden');

    let totalImpacto = 0; let totalErros = 0; const motivosMap = {};
    dados.forEach(item => {
        const impacto = parseLocalFloat(item.impacto);
        const div = parseLocalFloat(item.divergencia);
        const motivo = item.motivo || 'Outros';

        totalImpacto += impacto;
        if (div !== 0) totalErros++;

        if (!motivosMap[motivo]) motivosMap[motivo] = 0;
        motivosMap[motivo] += impacto;
    });

    if (document.getElementById('ui-almox-total-rs')) document.getElementById('ui-almox-total-rs').innerText = 'R$ ' + totalImpacto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (document.getElementById('ui-almox-total-itens')) document.getElementById('ui-almox-total-itens').innerText = dados.length;
    if (document.getElementById('ui-almox-total-erros')) document.getElementById('ui-almox-total-erros').innerText = totalErros;

    const divMotivos = document.getElementById('almox-lista-motivos');
    if (divMotivos) {
        const arr = Object.keys(motivosMap).map(k => ({ nome: k, val: motivosMap[k] })).sort((a, b) => b.val - a.val).slice(0, 5);
        divMotivos.innerHTML = arr.map((item, i) => `<div class="flex justify-between items-center p-2 border-b border-slate-100 last:border-0"><span class="text-sm font-medium text-slate-700">${i + 1}. ${item.nome}</span><span class="font-bold text-orange-600">R$ ${item.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`).join('');
    }
    if (window.lucide) window.lucide.createIcons();
};
// ==========================================
// 16. MÓDULO INDÚSTRIA: INVENTÁRIO (BIPAGEM FABRIL)
// ==========================================

window.renderListaInventariosInd = () => {
    const tbody = document.getElementById('inv-ind-tbody-consulta'); if (!tbody) return;
    const filtroFilial = document.getElementById('filtro-filial-contagem-ind')?.value;
    let inventarios = sheetsDataRaw.filter(i => i.tipo === 'ind_inventario' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') inventarios = inventarios.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    const mapInv = {};
    inventarios.forEach(i => {
        if (!i.id_inventario) return;
        if (!mapInv[i.id_inventario]) mapInv[i.id_inventario] = { id: i.id_inventario, filial: i.filial, qtdLeituras: 0, fechado: false };
        if (i.status === 'FECHADO' || i.gtin === 'FECHAMENTO') mapInv[i.id_inventario].fechado = true; else mapInv[i.id_inventario].qtdLeituras++;
    });

    const listaArr = Object.values(mapInv).sort((a, b) => { if (a.fechado !== b.fechado) return a.fechado ? 1 : -1; return b.id.localeCompare(a.id); });
    if (listaArr.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400 italic">Nenhum inventário fabril localizado.</td></tr>'; return; }

    let html = '';
    listaArr.forEach(inv => {
        const statusBadge = inv.fechado ? `<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-slate-200"><i class="w-3 h-3 inline pb-0.5" data-lucide="lock"></i> Fechado</span>` : `<span class="bg-emerald/10 text-emerald px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-emerald/20"><i class="w-3 h-3 inline pb-0.5" data-lucide="unlock"></i> Aberto</span>`;
        const btnContinuar = !inv.fechado ? `<button type="button" onclick="window.abrirTelaBipagemInd('${inv.id}', '${inv.filial}')" class="text-xs bg-navy text-white hover:bg-navyLight px-3 py-1.5 rounded shadow-sm inline-flex items-center gap-1"><i class="w-3 h-3" data-lucide="scan-barcode"></i> Contar</button>` : '';
        const btnExportar = `<button type="button" onclick="window.exportarInventarioIdInd('${inv.id}')" class="text-xs bg-white text-emerald border border-slate-200 px-3 py-1.5 rounded shadow-sm inline-flex items-center gap-1"><i class="w-3 h-3" data-lucide="file-spreadsheet"></i> Relatório</button>`;
        html += `<tr class="hover:bg-slate-50 transition-colors border-b border-slate-100"><td class="px-6 py-4 font-bold text-navy">${inv.id}</td><td class="px-6 py-4 text-slate-600 text-xs">${inv.filial}</td><td class="px-6 py-4">${statusBadge}</td><td class="px-6 py-4 text-center font-medium text-slate-700">${inv.qtdLeituras}</td><td class="px-6 py-4 text-right space-x-2">${btnContinuar} ${btnExportar}</td></tr>`;
    });
    tbody.innerHTML = html; if (window.lucide) lucide.createIcons();
};

window.abrirTelaBipagemInd = (idInv, filial) => { document.getElementById('inv-ind-tela-selecao').classList.add('hidden'); document.getElementById('inv-ind-tela-bipagem').classList.remove('hidden'); document.getElementById('ui-inv-ind-id').innerText = idInv; document.getElementById('ui-inv-ind-filial').innerText = filial; document.getElementById('inv-ind-id-oculto').value = idInv; document.getElementById('inv-ind-filial-oculto').value = filial; setTimeout(() => document.getElementById('inv-ind-lote').focus(), 100); window.renderHistoricoBipagemInd(idInv); };
window.voltarTelaInventarioInd = () => { document.getElementById('inv-ind-tela-bipagem').classList.add('hidden'); document.getElementById('inv-ind-tela-selecao').classList.remove('hidden'); window.renderListaInventariosInd(); };

window.iniciarNovoInventarioInd = (event) => {
    const filial = document.getElementById('inv-ind-nova-filial').value; if (!filial) { alert('Selecione a filial.'); return; }
    const novoId = 'INVI-' + Math.floor(100000 + Math.random() * 900000); // INVI = Inventário Indústria
    window.abrirTelaBipagemInd(novoId, filial);
};

window.consultarInventarioInd = () => {
    let busca = document.getElementById('inv-ind-id-busca').value.trim().toUpperCase(); if (!busca) return; if (!busca.startsWith('INVI-')) busca = 'INVI-' + busca;
    const inventarios = sheetsDataRaw.filter(i => i.tipo === 'ind_inventario' && i.id_inventario === busca);
    if (inventarios.length === 0) { alert('Não encontrado.'); return; }
    if (inventarios.some(i => i.status === 'FECHADO')) { alert('Inventário encerrado.'); return; }
    window.abrirTelaBipagemInd(busca, inventarios[0].filial);
};

window.encerrarInventarioAtualInd = async (event) => {
    const idInv = document.getElementById('inv-ind-id-oculto').value; const filial = document.getElementById('inv-ind-filial-oculto').value;
    if (!confirm(`Deseja encerrar o ${idInv}?`)) return;
    const btn = event.currentTarget; const txtOriginal = btn.innerHTML; btn.innerHTML = '<i class="w-4 h-4 animate-spin" data-lucide="loader-2"></i> Fechando...';
    const payload = { tipo: "fechar_ind_inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, id_inventario: idInv };

    sheetsDataRaw.push({ tipo: 'ind_inventario', id_inventario: idInv, status: 'FECHADO', gtin: 'FECHAMENTO', filial: filial });
    window.voltarTelaInventarioInd();
    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); }
    catch (err) { alert('Erro ao fechar.'); } finally { btn.innerHTML = txtOriginal; }
};

document.getElementById('form-inventario-ind')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const idInv = document.getElementById('inv-ind-id-oculto').value; const filial = document.getElementById('inv-ind-filial-oculto').value;
    const inputLote = document.getElementById('inv-ind-lote'); const inputGtin = document.getElementById('inv-ind-gtin'); const inputQtd = document.getElementById('inv-ind-qtd');
    const lote = inputLote.value.trim().toUpperCase();

    const payload = { tipo: "ind_inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, lote: lote, gtin: inputGtin.value, descricao: document.getElementById('inv-ind-desc')?.value || "", quantidade: inputQtd.value, id_inventario: idInv, status: "ABERTO" };
    submitToSheets(null, 'btn-save-inv-ind', '', '', payload, '<i data-lucide="plus-square" class="w-5 h-5 text-gold"></i> Salvar Bipagem Fabril');

    inputGtin.value = ''; document.getElementById('inv-ind-desc').value = '';
    setTimeout(() => { inputGtin.focus(); }, 50); window.renderHistoricoBipagemInd(idInv);
});

window.renderHistoricoBipagemInd = (idInv) => {
    const divHist = document.getElementById('inv-ind-historico-bipagem'); if (!divHist) return;
    const items = sheetsDataRaw.filter(i => i.tipo === 'ind_inventario' && i.id_inventario === idInv && i.gtin !== 'FECHAMENTO').reverse();
    if (items.length === 0) { divHist.innerHTML = '<p class="text-xs text-slate-400 italic">Nenhum item bipado.</p>'; } else {
        let html = '';
        items.slice(0, 15).forEach(i => {
            const itemEnc = encodeURIComponent(JSON.stringify(i)); const isEstorno = parseFloat(i.quantidade) < 0;
            const btnExcluir = isEstorno ? '' : `<button type="button" onclick="window.estornarBipagemInd('${itemEnc}')" class="text-red-400 hover:text-red-600 p-1.5 rounded transition-colors"><i class="w-4 h-4" data-lucide="trash-2"></i></button>`;
            const corQtd = isEstorno ? 'text-red-600 bg-red-50 border-red-200' : 'text-emerald bg-emerald/10 border-emerald/20';
            const textNome = isEstorno ? 'text-red-600 line-through' : 'text-navy';
            html += `<div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded mb-1"><div class="flex flex-col flex-1 min-w-0 pr-2"><span class="text-xs font-bold ${textNome} truncate">${i.descricao || i.gtin}</span><span class="text-[10px] text-slate-400">Lote: ${i.lote} | EAN/Ref: ${i.gtin}</span></div><div class="flex items-center gap-2 shrink-0"><span class="text-sm font-black px-2 py-1 rounded border ${corQtd}">${i.quantidade}</span>${btnExcluir}</div></div>`;
        });
        divHist.innerHTML = html; if (window.lucide) window.lucide.createIcons();
    }
};

window.estornarBipagemInd = async (itemEncoded) => {
    if (!confirm("Deseja cancelar esta leitura fabril?")) return;
    const item = JSON.parse(decodeURIComponent(itemEncoded));
    const payload = { ...item, quantidade: -Math.abs(parseFloat(item.quantidade)), descricao: "[ESTORNO] " + (item.descricao || "Produto") };
    sheetsDataRaw.push(payload); window.renderHistoricoBipagemInd(item.id_inventario);
    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); } catch (e) { }
};

window.exportarInventarioIdInd = (idInv) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === 'ind_inventario' && i.id_inventario === idInv);
    if (dataToExport.length === 0) { alert("Sem dados."); return; }
    const rows = []; rows.push(["Data do Registo", "Lote/Area", "GTIN/Ref", "Descrição", "Quantidade", "Status"].join(";"));
    dataToExport.forEach(item => { if (item.gtin === 'FECHAMENTO') return; rows.push([`"${item.data_registro || ''}"`, `"${item.lote || 'Sem Lote'}"`, `"${item.gtin || ''}"`, `"${item.descricao || 'Produto'}"`, `${item.quantidade || 0}`, `"Contado"`].join(";")); });
    const csvContent = "\uFEFF" + rows.join("\n"); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.setAttribute("download", `Inventario_Fabril_${idInv}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
};
// ==========================================
// 17. MOTOR DE DIAGNÓSTICO E ROI (BASE EXCEL)
// ==========================================
// Função para formatar o campo em tempo real (Máscara)
window.mascaraMoeda = (input) => {
    let valor = input.value.replace(/\D/g, "");
    valor = (valor / 100).toFixed(2) + "";
    valor = valor.replace(".", ",");
    valor = valor.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    input.value = valor;
};

// Função para converter a string "1.500,00" em número "1500.00" para cálculo
const limparMoeda = (valor) => {
    if (!valor) return 0;
    return parseFloat(valor.replace(/\./g, "").replace(",", ".")) || 0;
};

window.calcularDiagnostico = () => {
    // Captura os valores usando a função de limpeza
    const fat = limparMoeda(document.getElementById('diag-faturamento').value);
    const cmv = limparMoeda(document.getElementById('diag-cmv').value);
    const estoque = limparMoeda(document.getElementById('diag-estoque').value);
    const perdaPerc = (parseFloat(document.getElementById('diag-perda-perc').value) || 0) / 100;

    if (fat === 0) return;

    const perdaMensal = fat * perdaPerc;
    const perdaDia = perdaMensal / 30;
    const cobertura = cmv > 0 ? estoque / (cmv / 30) : 0;

    // Formatação de saída (R$ 1.000,00)
    const formatBRL = (valor) => {
        return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    // Lógica de Status
    const statusPerda = perdaPerc <= 0.0151
        ? '<span class="inline-block mt-1 text-emerald font-bold text-[10px] bg-emerald/10 border border-emerald/20 px-2 py-0.5 rounded">✅ BOM</span>'
        : '<span class="inline-block mt-1 text-red-400 font-bold text-[10px] bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">⚠️ ALTO</span>';

    const statusCobertura = (cobertura >= 30 && cobertura <= 45)
        ? '<span class="inline-block mt-1 text-emerald font-bold text-[10px] bg-emerald/10 border border-emerald/20 px-2 py-0.5 rounded">✅ BOM</span>'
        : '<span class="inline-block mt-1 text-orange-500 font-bold text-[10px] bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">⚠️ ATENÇÃO</span>';

    // Atualiza os Cards
    const resPerdaTotal = document.getElementById('res-perda-total');
    const resCobertura = document.getElementById('res-cobertura');
    const resPerdaDia = document.getElementById('res-perda-dia');

    if (resPerdaTotal) resPerdaTotal.innerHTML = `${formatBRL(perdaMensal)} <br/>${statusPerda}`;
    if (resCobertura) resCobertura.innerHTML = `${Math.round(cobertura)} dias <br/>${statusCobertura}`;
    if (resPerdaDia) resPerdaDia.innerText = formatBRL(perdaDia);

    // Tabela de Origem
    const origens = [
        { nome: "Perdas Desconhecidas", perc: 0.4613, causa: "Furtos e Fraudes" },
        { nome: "Perdas Conhecidas", perc: 0.3328, causa: "Validade e Avaria" },
        { nome: "Perdas Administrativas", perc: 0.1857, causa: "Erros de Processo" },
        { nome: "Perdas Financeiras", perc: 0.0202, causa: "Preço e Caixa" }
    ];

    const tbody = document.getElementById('diag-table-body');
    if (tbody) {
        tbody.innerHTML = origens.map(o => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3">
                    <p class="font-bold text-navy">${o.nome}</p>
                    <p class="text-[9px] text-slate-400 uppercase font-medium">${o.causa}</p>
                </td>
                <td class="px-4 py-3 text-center font-bold text-slate-500 bg-slate-50/50">${(o.perc * 100).toFixed(2)}%</td>
                <td class="px-4 py-3 text-right font-black text-navy">${formatBRL(perdaMensal * o.perc)}</td>
            </tr>
        `).join('');
    }

    // --- CÁLCULO DE INVESTIMENTO E ROI ---

    // 1. Investimentos (Percentuais sobre faturamento)
    const invs = [fat * 0.0140, fat * 0.0230, fat * 0.0070, fat * 0.0010];

    // 2. Economia Mensal (30% de recuperação sobre a perda de cada módulo)
    const ecos = [
        (perdaMensal * 0.3328) * 0.30,
        (perdaMensal * 0.4613) * 0.30,
        (perdaMensal * 0.1857) * 0.30,
        (perdaMensal * 0.0202) * 0.30
    ];

    const proposta = [
        { nome: "Módulo 1 - Perdas Conhecidas", inv: invs[0], ecoM: ecos[0] },
        { nome: "Módulo 2 - Perdas Desconhecidas", inv: invs[1], ecoM: ecos[1] },
        { nome: "Módulo 3 - Perdas Administrativas", inv: invs[2], ecoM: ecos[2] },
        { nome: "Módulo 4 - Perdas Financeiras", inv: invs[3], ecoM: ecos[3] }
    ];

    let totalInv = 0, totalEcoM = 0, totalEcoA = 0;

    const tbodyRoi = document.getElementById('diag-roi-body');
    if (tbodyRoi) {
        tbodyRoi.innerHTML = proposta.map(m => {
            const ecoAnual = m.ecoM * 12;
            const roiVal = m.inv > 0 ? (ecoAnual / m.inv) * 100 : 0;

            totalInv += m.inv;
            totalEcoM += m.ecoM;
            totalEcoA += ecoAnual;

            return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 font-bold text-navy">${m.nome}</td>
                <td class="px-4 py-3 text-right font-black text-slate-700">${formatBRL(m.inv)}</td>
                <td class="px-4 py-3 text-right font-bold text-emerald">${formatBRL(m.ecoM)}</td>
                <td class="px-4 py-3 text-right font-bold text-navy bg-slate-50">${formatBRL(ecoAnual)}</td>
                <td class="px-4 py-3 text-center font-black text-emerald bg-emerald/5">${roiVal.toFixed(0)}%</td>
            </tr>`;
        }).join('');

        // Injetar Linha de Totais
        const tfootRoi = document.getElementById('diag-roi-footer');
        const totalRoi = totalInv > 0 ? (totalEcoA / totalInv) * 100 : 0;
        tfootRoi.innerHTML = `
            <tr>
                <td class="px-4 py-3 uppercase text-[9px]">Total da Proposta</td>
                <td class="px-4 py-3 text-right">${formatBRL(totalInv)}</td>
                <td class="px-4 py-3 text-right text-gold">${formatBRL(totalEcoM)}</td>
                <td class="px-4 py-3 text-right text-gold">${formatBRL(totalEcoA)}</td>
                <td class="px-4 py-3 text-center bg-gold text-navy font-black">${totalRoi.toFixed(0)}%</td>
            </tr>`;
    }

    // --- ANÁLISE DE CENÁRIOS (CARDS INFERIORES) ---
    const gridCenarios = document.getElementById('diag-cenarios-grid');
    if (gridCenarios) {
        // Função matemática para converter meses em texto legível (ex: "1 ano e 6 meses")
        const formatPayback = (meses) => {
            if (!isFinite(meses) || meses <= 0) return "Imediato";
            const m = Math.ceil(meses);
            const anos = Math.floor(m / 12);
            const mesesRestantes = m % 12;

            if (anos === 0) return `${mesesRestantes} ${mesesRestantes === 1 ? 'mês' : 'meses'}`;
            if (mesesRestantes === 0) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
            return `${anos} ${anos === 1 ? 'ano' : 'anos'} e ${mesesRestantes} ${mesesRestantes === 1 ? 'mês' : 'meses'}`;
        };

        const cenarios = [
            { label: "Conservador (15%)", perc: 0.15, desc: "Ações básicas de processo" },
            { label: "Esperado (30%)", perc: 0.30, desc: "Metodologia Proteção ao Lucro", destaque: true },
            { label: "Excelência (50%)", perc: 0.50, desc: "Cultura de Prevenção Total" }
        ];

        gridCenarios.innerHTML = cenarios.map(c => {
            const economia = perdaMensal * c.perc;
            const economiaAnual = economia * 12;

            // O Investimento Total é a soma dos 4 módulos (4,5% do Faturamento)
            const invTotalMensal = (fat * 0.0140) + (fat * 0.0230) + (fat * 0.0070) + (fat * 0.0010);
            const paybackMeses = economia > 0 ? invTotalMensal / economia : 0;

            return `
            <div class="p-4 rounded-xl border ${c.destaque ? 'border-gold bg-gold/5 shadow-md' : 'border-slate-100 bg-white'}">
                <div class="flex justify-between items-start mb-2">
                    <p class="text-[10px] font-bold uppercase ${c.destaque ? 'text-navy' : 'text-slate-400'}">${c.label}</p>
                    ${c.destaque ? '<span class="text-[8px] bg-navy text-white px-1.5 py-0.5 rounded-full">ALVO</span>' : ''}
                </div>
                <p class="text-lg font-black text-navy leading-none mb-1">${formatBRL(economiaAnual)}</p>
                <p class="text-[9px] font-medium text-slate-500 italic mb-3">de economia anual estimada</p>
                
                <div class="pt-3 border-t border-slate-100 space-y-2">
                    <div class="flex justify-between items-center">
                        <p class="text-[10px] text-slate-400 uppercase font-bold mb-0">Impacto Mensal:</p>
                        <p class="text-sm font-bold text-emerald">${formatBRL(economia)}</p>
                    </div>
                    
                    <div class="bg-slate-50 p-2 rounded border border-slate-200 text-center mt-2">
                        <p class="text-[9px] text-slate-500 uppercase font-bold mb-0.5">Tempo de Retorno (ROI)</p>
                        <p class="text-sm font-black text-navy">${formatPayback(paybackMeses)}</p>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
};
window.imprimirPDF = () => {
    // Garante que os ícones do Lucide carreguem antes de imprimir
    if (window.lucide) window.lucide.createIcons();
    // Abre a janela de impressão do navegador (onde você escolhe 'Salvar como PDF')
    window.print();
};

// ==========================================
// MOTOR DE RESULTADOS DE KPI (CONSULTOR)
// ==========================================

window.mapaEmpresasFiliais = {};

window.carregarFiltrosKpi = async () => {
    const selEmpresa = document.getElementById('kpi-empresa');
    const selFilial = document.getElementById('kpi-filial');
    const inputMes = document.getElementById('kpi-mes');
    const inputVenda = document.getElementById('kpi-venda');
    const inputDesc = document.getElementById('kpi-desconto-pdv');
    const inputRef = document.getElementById('kpi-referencia-r$');

    if (!selEmpresa || !selFilial || !inputMes || !inputVenda || !inputDesc || !inputRef) return;

    // Se já foi carregado (já tem mais que 1 option), não carrega de novo
    if (selEmpresa.options.length > 1) return;

    // Previne múltiplas chamadas e dá feedback visual
    selEmpresa.innerHTML = '<option value="">Carregando...</option>';
    selFilial.innerHTML = '<option value="">Carregando...</option>';

    try {
        if (typeof db === 'undefined') throw new Error("Firebase DB não disponível");

        const snapshot = await getDocs(collection(db, 'users_permissions'));
        window.mapaEmpresasFiliais = {};
        window.mapaEmailEmpresa = {};
        const todasFiliais = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.email && data.company_name) {
                window.mapaEmailEmpresa[data.email.trim().toLowerCase()] = data.company_name.trim();
            }
            const emp = data.company_name?.trim();

            if (emp) {
                if (!window.mapaEmpresasFiliais[emp]) {
                    window.mapaEmpresasFiliais[emp] = new Set();
                }
                if (data.unit_name) {
                    const unidades = data.unit_name.split(',').map(u => u.trim()).filter(Boolean);
                    unidades.forEach(u => {
                        window.mapaEmpresasFiliais[emp].add(u);
                        todasFiliais.add(u);
                    });
                }
            }
        });

        // Limpa e popula o select de Empresa
        selEmpresa.innerHTML = '<option value="">Todas as Empresas</option>';
        Object.keys(window.mapaEmpresasFiliais).sort().forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp; opt.innerText = emp;
            selEmpresa.appendChild(opt);
        });

        // Função auxiliar para popular as filiais
        const popularFiliais = (setFiliais) => {
            selFilial.innerHTML = '<option value="">Todas as Filiais</option>';
            [...setFiliais].sort().forEach(fil => {
                const opt = document.createElement('option');
                opt.value = fil; opt.innerText = fil;
                selFilial.appendChild(opt);
            });
        };

        // Popula filial inicial (com todas as filiais do banco)
        popularFiliais(todasFiliais);

        // A Mágica do Cascading (Evento Change na Empresa)
        selEmpresa.addEventListener('change', () => {
            const empSelecionada = selEmpresa.value;
            if (empSelecionada && window.mapaEmpresasFiliais[empSelecionada]) {
                popularFiliais(window.mapaEmpresasFiliais[empSelecionada]);
            } else {
                popularFiliais(todasFiliais); // Se desmarcou empresa, mostra todas
            }
            // Não precisa chamar calcularKpiConsultor() aqui, pois o gatilho geral abaixo também vai rodar
        });

    } catch (error) {
        console.error("Erro ao buscar empresas/filiais no Firebase:", error);
        selEmpresa.innerHTML = '<option value="">Erro de conexão</option>';
        selFilial.innerHTML = '<option value="">Erro de conexão</option>';
    }

    // Setar Mês corrente por padrão se estiver vazio
    if (!inputMes.value) {
        const hoje = new Date();
        inputMes.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    }

    // Associar eventos para recalcular ao vivo
    [selEmpresa, selFilial, inputMes, inputVenda, inputDesc, inputRef].forEach(el => {
        el.removeEventListener('change', window.calcularKpiConsultor);
        el.removeEventListener('keyup', window.calcularKpiConsultor);
        el.addEventListener('change', window.calcularKpiConsultor);
        el.addEventListener('keyup', window.calcularKpiConsultor);
    });

    // Força o primeiro cálculo
    window.calcularKpiConsultor();
};

window.calcularKpiConsultor = () => {
    const norm = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

    const selEmpresa = document.getElementById('kpi-empresa');
    const selFilial = document.getElementById('kpi-filial');
    const inputMes = document.getElementById('kpi-mes');
    const inputVenda = document.getElementById('kpi-venda');
    const inputDesc = document.getElementById('kpi-desconto-pdv');
    const inputRef = document.getElementById('kpi-referencia-r$');

    if (!selEmpresa || !selFilial || !inputMes || !inputVenda || !inputDesc || !inputRef) return;

    const filtroEmpresa = selEmpresa.value;
    const filtroFilial = selFilial.value;
    const filterEmpStr = norm(filtroEmpresa);
    const filterFilStr = norm(filtroFilial);
    const filtroMes = inputMes.value; // YYYY-MM
    const vendaBruta = parseFloat(inputVenda.value) || 0;
    const descontosPDV = parseFloat(inputDesc.value) || 0;
    const linhaBase = parseFloat(inputRef.value) || 0;

    let perdaConhecida = 0;
    let perdaDesconhecida = 0;
    let perdaAdministrativa = 0;
    let perdaFinanceira = descontosPDV; // Base começa com descontos no PDV

    // Encontrar inventários fechados
    const inventariosFechados = new Set();
    sheetsDataRaw.forEach(i => {
        const getVal = (chaveBusca) => {
            const chaveReal = Object.keys(i).find(k => norm(k).includes(norm(chaveBusca)));
            return chaveReal ? i[chaveReal] : '';
        };
        const idInv = String(getVal('inventario') || getVal('id')).trim();
        if (i.tipo === 'inventario' && i.gtin === 'FECHAMENTO') {
            inventariosFechados.add(idInv);
        }
    });

    sheetsDataRaw.forEach(i => {
        const getVal = (chaveBusca) => {
            const chaveReal = Object.keys(i).find(k => norm(k).includes(norm(chaveBusca)));
            return chaveReal ? i[chaveReal] : '';
        };
        // Filtragem por Empresa e Filial
        const rowEmail = norm(getVal('usu') || getVal('email'));
        let rowEmpresa = norm(getVal('empresa'));
        let rowFilial = norm(getVal('filial') || getVal('loja'));

        if (rowEmail && window.mapaEmailEmpresa) {
            const empBanco = window.mapaEmailEmpresa[rowEmail] || window.mapaEmailEmpresa[rowEmail.toLowerCase()];
            if (empBanco) rowEmpresa = norm(empBanco);
        }

        console.log('🔍 [AUDITORIA DE LINHA]');
        console.log('1. Objeto RAW do Sheets:', i);
        console.log('2. Extração -> Email:', rowEmail, '| Empresa:', rowEmpresa, '| Filial:', rowFilial);
        console.log('3. Filtros da Tela -> Empresa:', filterEmpStr, '| Filial:', filterFilStr);

        if (filterEmpStr && rowEmpresa !== filterEmpStr) return;
        if (filterFilStr && rowFilial !== filterFilStr) return;

        // Filtragem Temporal Flexível
        let matchData = false;
        if (filtroMes) {
            let dataAlvo = i.data_registro || i.mes || i.data_auditoria || i.data_ocorrencia || '';
            const dataStr = String(dataAlvo).trim();

            // Tentar extrair YYYY-MM
            if (dataStr.includes('/')) {
                // Padrão DD/MM/YYYY
                const partes = dataStr.split(' ')[0].split('/');
                if (partes.length >= 3) {
                    const anoMesItem = `${partes[2]}-${partes[1].padStart(2, '0')}`;
                    if (anoMesItem === filtroMes) matchData = true;
                }
            } else if (dataStr.includes('-')) {
                // Padrão YYYY-MM
                if (dataStr.startsWith(filtroMes)) matchData = true;
            }
        } else {
            matchData = true; // Se não houver filtro de mês preenchido, não filtra
        }

        if (!matchData) return;

        const custo = parseFloat(String(i.custo).replace(',', '.')) || 0;
        const qtd = parseFloat(String(i.quantidade).replace(',', '.')) || 0;
        const valorFinanceiro = custo * qtd; // Mantemos os estornos intactos

        if (i.tipo === 'quebra') {
            perdaConhecida += valorFinanceiro;
        }
        else if (i.tipo === 'inventario' && i.gtin !== 'FECHAMENTO' && i.gtin !== 'LISTA_DIRIGIDA') {
            const idInv = String(getVal('inventario') || getVal('id')).trim();
            if (inventariosFechados.has(idInv)) {
                const motivo = String(i.motivo || '').trim();
                if (motivo === 'Não Identificado' || motivo === '') {
                    perdaDesconhecida += valorFinanceiro;
                } else {
                    perdaAdministrativa += valorFinanceiro;
                }
            }
        }
        else if (i.tipo === 'caixa' || i.tipo === 'caixa_central') {
            // A quebra de caixa já pode vir negativa do Sheets (ex: sobra em vez de falta). Somamos tudo no bolo.
            const valorFalta = parseFloat(String(i.valor_falta || 0).replace(',', '.')) || 0;
            perdaFinanceira += valorFalta;
        }
    });

    // Aplicamos a trava de zero apenas no total consolidado para não distorcer o balanço
    perdaConhecida = Math.max(0, perdaConhecida);
    perdaDesconhecida = Math.max(0, perdaDesconhecida);
    perdaAdministrativa = Math.max(0, perdaAdministrativa);
    perdaFinanceira = Math.max(0, perdaFinanceira);

    const perdaGlobal = perdaConhecida + perdaDesconhecida + perdaAdministrativa + perdaFinanceira;
    const indicePerda = vendaBruta > 0 ? (perdaGlobal / vendaBruta) * 100 : 0;
    const economia = linhaBase - perdaGlobal;

    // Atualização da UI
    const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    const uiConhecida = document.getElementById('ui-kpi-conhecida');
    const uiDesconhecida = document.getElementById('ui-kpi-desconhecida');
    const uiAdministrativa = document.getElementById('ui-kpi-administrativa');
    const uiFinanceira = document.getElementById('ui-kpi-financeira');
    const uiGlobal = document.getElementById('ui-kpi-global');
    const uiIndice = document.getElementById('ui-kpi-indice');
    const uiEconomia = document.getElementById('ui-kpi-economia');

    if (uiConhecida) uiConhecida.innerText = formatter.format(perdaConhecida);
    if (uiDesconhecida) uiDesconhecida.innerText = formatter.format(perdaDesconhecida);
    if (uiAdministrativa) uiAdministrativa.innerText = formatter.format(perdaAdministrativa);
    if (uiFinanceira) uiFinanceira.innerText = formatter.format(perdaFinanceira);
    if (uiGlobal) uiGlobal.innerText = formatter.format(perdaGlobal);
    if (uiIndice) uiIndice.innerText = indicePerda.toFixed(2) + '%';

    if (uiEconomia) {
        uiEconomia.innerText = formatter.format(economia);
        uiEconomia.className = economia >= 0 ? "text-3xl font-black text-emerald-400 relative z-10" : "text-3xl font-black text-red-400 relative z-10";
    }
};

// Iniciar Motor se a tab de KPI for aberta
document.getElementById('btn-admin-tab-kpi')?.addEventListener('click', () => {
    setTimeout(window.carregarFiltrosKpi, 200);
});

// ==========================================
// GRAVAÇÃO DE KPI (FIREBASE)
// ==========================================
window.salvarRelatorioKpi = async () => {
    const selEmpresa = document.getElementById('kpi-empresa')?.value;
    const selFilial = document.getElementById('kpi-filial')?.value;
    const inputMes = document.getElementById('kpi-mes')?.value;
    const inputVenda = document.getElementById('kpi-venda')?.value;

    if (!selEmpresa || !selFilial || !inputMes) {
        alert("Por favor, selecione Empresa, Filial e Mês de Referência antes de gravar.");
        return;
    }

    const btn = document.getElementById('btn-save-kpi');
    const msgSuccess = document.getElementById('msg-kpi-success');
    const msgError = document.getElementById('msg-kpi-error');

    btn.disabled = true;
    btn.innerHTML = '<i class="w-5 h-5 animate-spin" data-lucide="loader-2"></i> Gravando...';
    if (window.lucide) window.lucide.createIcons();
    msgSuccess.classList.add('hidden');
    msgError.classList.add('hidden');

    const parseBRL = (str) => {
        if (!str) return 0;
        // Ex: R$ 1.500,50 -> 1500.50
        const limpo = str.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
        return parseFloat(limpo) || 0;
    };

    const payload = {
        empresa: selEmpresa,
        filial: selFilial,
        mes_referencia: inputMes,
        venda_bruta: parseFloat(inputVenda) || 0,
        perda_conhecida: parseBRL(document.getElementById('ui-kpi-conhecida')?.innerText),
        perda_desconhecida: parseBRL(document.getElementById('ui-kpi-desconhecida')?.innerText),
        perda_administrativa: parseBRL(document.getElementById('ui-kpi-administrativa')?.innerText),
        perda_financeira: parseBRL(document.getElementById('ui-kpi-financeira')?.innerText),
        perda_global: parseBRL(document.getElementById('ui-kpi-global')?.innerText),
        indice_perda: parseFloat((document.getElementById('ui-kpi-indice')?.innerText || '0').replace('%', '')) || 0,
        economia_gerada: parseBRL(document.getElementById('ui-kpi-economia')?.innerText),
        timestamp: serverTimestamp()
    };

    try {
        await addDoc(collection(db, 'artifacts/lucroseguro-app/public/data/kpis_mensais'), payload);
        msgSuccess.classList.remove('hidden');
        setTimeout(() => { msgSuccess.classList.add('hidden'); }, 4000);
    } catch (error) {
        console.error("Erro ao gravar KPI:", error);
        msgError.innerText = "Erro ao gravar histórico: " + error.message;
        msgError.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="w-5 h-5" data-lucide="save"></i> Gravar Histórico no Portal';
        if (window.lucide) window.lucide.createIcons();
    }
};
