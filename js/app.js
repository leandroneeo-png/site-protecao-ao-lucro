// ==========================================
// 1. IMPORTS & CONFIGURAÇÃO DO FIREBASE
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

if(window.lucide) lucide.createIcons();

// ==========================================
// 3. FUNÇÕES UTILITÁRIAS E ATUALIZAÇÃO UI
// ==========================================
const autoFillDates = () => {
    const hoje = new Date();
    const dataFormatada = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    ['p-data', 'f-data', 'c-data', 't-prazo', 'r-data'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.value = dataFormatada;
    });
};
autoFillDates();

const parseLocalFloat = (val) => {
    if(typeof val === 'number') return val;
    if(!val) return 0;
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
    if(dataToExport.length === 0) { alert("Sem dados processados para exportar."); return; }
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
    try { window.renderQuebrasDashboard(); } catch(e) {}
    try { window.renderPrecoDashboard(); } catch(e) {}
    try { window.renderDocasDashboard(); } catch(e) {}
    try { window.renderValidadeDashboard(); } catch(e) {}
    try { window.renderFurtosDashboard(); } catch(e) {}
    try { window.renderCaixaDashboard(); } catch(e) {}
    try { window.renderTarefasDashboard(); } catch(e) {}
    try { window.renderListaInventarios(); } catch(e) {}
    if(window.lucide) lucide.createIcons();
};

// ==========================================
// 4. MOTOR DE INTEGRAÇÃO (CACHE SWR E OTIMISTA)
// ==========================================
const submitToSheets = async (form, btnId, msgSuccessId, msgErrorId, payload, btnOriginalText) => {
    const btn = document.getElementById(btnId);
    const msgSuccess = document.getElementById(msgSuccessId);
    const msgError = document.getElementById(msgErrorId);
    
    if(btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A enviar...'; }
    if(msgSuccess) msgSuccess.classList.add('hidden');
    if(msgError) msgError.classList.add('hidden');
    if(window.lucide) lucide.createIcons();

    // INJEÇÃO OTIMISTA: Atualiza a tela antes mesmo de o Google responder
    if (payload.tipo !== 'atualizar_validade' && payload.tipo !== 'concluir_tarefa' && payload.tipo !== 'fechar_inventario' && payload.tipo !== 'atualizar_rebaixa_validade') {
        const payloadExists = sheetsDataRaw.some(i => JSON.stringify(i) === JSON.stringify(payload));
        if(!payloadExists) {
            sheetsDataRaw.push(payload);
            window.triggerAllRenders();
        }
    }
    
    try {
        const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
            method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            if(payload.tipo === 'atualizar_validade') {
                const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(payload.gtin) && i.data_validade === payload.data_validade);
                if (idx !== -1) { 
                    if (parseFloat(payload.quantidade) <= 0) sheetsDataRaw.splice(idx, 1); 
                    else sheetsDataRaw[idx].quantidade = payload.quantidade; 
                }
                window.triggerAllRenders();
            } 
            
            if(form) form.reset();
            if(msgSuccess) { msgSuccess.classList.remove('hidden'); setTimeout(() => msgSuccess.classList.add('hidden'), 5000); }
            
            // Atualiza o cache silenciosamente após sucesso
            sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre]));
        } else {
            throw new Error(result.message || "Erro desconhecido na planilha.");
        }
    } catch (error) {
        if(msgError) { msgError.innerText = error.message; msgError.classList.remove('hidden'); }
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = btnOriginalText; } 
        if(window.lucide) lucide.createIcons();
    }
};

window.fetchSheetsDataComHierarquia = async () => {
    const loadingQ = document.getElementById('loading-quebras');
    const loadingMain = document.getElementById('loading-data');
    const cacheKey = `lucroData_${currentUserFilial}`;

    // Configuração dos filtros iniciais
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    ['quebra', 'docas', 'validade', 'furtos', 'preco', 'caixa', 'inv', 'tar'].forEach(id => {
        const filtroMes = document.getElementById(`filtro-mes-${id}`);
        const filtroFilial = document.getElementById(`filtro-filial-${id}`);
        if(filtroMes && !filtroMes.value) filtroMes.value = mesAtual;
        
        const trg = () => {
            if(id==='quebra') window.renderQuebrasDashboard();
            if(id==='docas') window.renderDocasDashboard();
            if(id==='validade') window.renderValidadeDashboard();
            if(id==='furtos') window.renderFurtosDashboard();
            if(id==='preco') window.renderPrecoDashboard();
            if(id==='caixa') window.renderCaixaDashboard();
            if(id==='inv') window.renderListaInventarios();
            if(id==='tar') window.renderTarefasDashboard();
        };
        if(filtroMes) filtroMes.onchange = trg;
        if(filtroFilial) filtroFilial.onchange = trg;
    });

    // 1. CARREGAMENTO INSTANTÂNEO (SWR CACHE)
    const cachedData = sessionStorage.getItem(cacheKey);
    if (cachedData) {
        try {
            const parsed = JSON.parse(cachedData);
            sheetsDataRaw = parsed.filter(i => i.tipo !== 'produto');
            produtosMestre = parsed.filter(i => i.tipo === 'produto');
            window.triggerAllRenders();
            if(loadingQ) loadingQ.classList.add('hidden');
            if(loadingMain) loadingMain.classList.add('hidden');
        } catch(e) { console.error("Erro no Cache", e); }
    } else {
        if(loadingQ) loadingQ.classList.remove('hidden');
        if(loadingMain) loadingMain.classList.remove('hidden');
    }

    // 2. BUSCA NO BACKGROUND SILENCIOSA
    try {
        const userEmailReq = auth.currentUser ? auth.currentUser.email : 'anonimo';
        const urlSegura = `${GOOGLE_SHEETS_WEBAPP_URL}?empresa=${encodeURIComponent(currentUserEmpresa)}&filial=${encodeURIComponent(currentUserFilial)}&role=${encodeURIComponent(currentUserRole)}&user=${encodeURIComponent(userEmailReq)}&t=${Date.now()}`;
        
        const res = await fetch(urlSegura);
        const data = await res.json();
        
        if(data && Array.isArray(data)) {
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            sheetsDataRaw = data.filter(i => i.tipo !== 'produto');
            produtosMestre = data.filter(i => i.tipo === 'produto');
            window.triggerAllRenders(); // Atualiza subtilmente se houver dados novos
        }
    } catch(e) {
        console.error("Erro ao buscar dados do Sheets:", e);
    } finally {
        if(loadingQ) loadingQ.classList.add('hidden');
        if(loadingMain) loadingMain.classList.add('hidden');
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
    
    if(!filtroMes) return;

    let dadosMes = sheetsDataRaw.filter(i => i.tipo === 'quebra' && i.mes && extrairAnoMes(i.mes) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosMes = dadosMes.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosMes.length === 0) { if(contentQ) contentQ.classList.add('hidden'); if(emptyQ) emptyQ.classList.remove('hidden'); return; }
    
    if(emptyQ) emptyQ.classList.add('hidden'); if(contentQ) contentQ.classList.remove('hidden');
    
    let totalRs = 0; let totalQtd = 0; const motivosMap = {}; const rankingMap = {};
    dadosMes.forEach(item => { 
        const qtd = parseLocalFloat(item.quantidade); const custo = parseLocalFloat(item.custo); 
        const valorTotal = qtd * custo; const motivo = item.motivo || 'Outros'; const produto = item.descricao || 'Produto sem nome';
        totalRs += valorTotal; totalQtd += qtd; 
        if(!motivosMap[motivo]) motivosMap[motivo] = 0; motivosMap[motivo] += valorTotal; 
        if(!rankingMap[produto]) rankingMap[produto] = 0; rankingMap[produto] += valorTotal;
    });

    if(document.getElementById('ui-quebra-total-rs')) document.getElementById('ui-quebra-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-quebra-total-qtd')) document.getElementById('ui-quebra-total-qtd').innerText = totalQtd.toLocaleString('pt-BR');

    const divChart = document.querySelector("#chart-motivos"); 
    if(divChart && typeof ApexCharts !== 'undefined') {
        if(chartMotivosInstance) chartMotivosInstance.destroy(); 
        chartMotivosInstance = new ApexCharts(divChart, {
            series: Object.values(motivosMap), labels: Object.keys(motivosMap),
            chart: { type: 'donut', height: 280, fontFamily: 'Inter, sans-serif' }, colors:['#0A2540', '#008950', '#f97316', '#eab308', '#ef4444', '#8b5cf6'], 
            dataLabels: { enabled: false }, legend: { position: 'right' },
            tooltip: { y: { formatter: function (val) { return "R$ " + val.toLocaleString('pt-BR', {minimumFractionDigits: 2}); } } }
        }); 
        chartMotivosInstance.render();
    }

    const divRanking = document.getElementById('ranking-list');
    if(divRanking) {
        const rankingArray = Object.keys(rankingMap).map(key => ({ produto: key, valor: rankingMap[key] })).sort((a, b) => b.valor - a.valor);
        divRanking.innerHTML = '';
        rankingArray.slice(0, 5).forEach((item, index) => {
            divRanking.innerHTML += `<div class="flex justify-between items-center p-3 hover:bg-slate-50 rounded-lg transition-colors border-b border-slate-100 last:border-0"><div class="flex items-center gap-3"><span class="text-lg font-bold text-slate-300 w-5">${index + 1}º</span><span class="font-medium text-slate-700">${item.produto}</span></div><span class="font-bold text-red-600">R$ ${item.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>`;
        });
        if(rankingArray.length === 0) divRanking.innerHTML = '<p class="text-sm text-slate-400 italic py-2">Nenhum dado para o ranking.</p>';
    }
};

window.renderDocasDashboard = () => {
    const contentD = document.getElementById('docas-dashboard-content'); const emptyD = document.getElementById('empty-state-docas');
    const filtroMes = document.getElementById('filtro-mes-docas')?.value; const filtroFilial = document.getElementById('filtro-filial-docas')?.value;
    
    let dadosDocas = sheetsDataRaw.filter(i => i.tipo === 'recebimento');
    if (filtroMes) dadosDocas = dadosDocas.filter(i => extrairAnoMes(i.data_entrega) === filtroMes);
    if (filtroFilial && filtroFilial !== 'todas') dadosDocas = dadosDocas.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosDocas.length === 0) { if(contentD) contentD.classList.add('hidden'); if(emptyD) emptyD.classList.remove('hidden'); return; }
    if(emptyD) emptyD.classList.add('hidden'); if(contentD) contentD.classList.remove('hidden');

    let totalDivergencias = 0; let custoDivergencias = 0; const divLista = document.getElementById('docas-lista-divergencias'); 
    dadosDocas.forEach(item => { totalDivergencias += parseLocalFloat(item.quantidade); custoDivergencias += (parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo)); });

    if(document.getElementById('ui-docas-total')) document.getElementById('ui-docas-total').innerText = totalDivergencias.toLocaleString('pt-BR');
    if(document.getElementById('ui-docas-custo')) document.getElementById('ui-docas-custo').innerText = 'R$ ' + custoDivergencias.toLocaleString('pt-BR', {minimumFractionDigits: 2});

    if(divLista) {
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
    if(filtroFilial && filtroFilial !== 'todas') dadosValidade = dadosValidade.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosValidade.length === 0) { if(contentV) contentV.classList.add('hidden'); if(emptyV) emptyV.classList.remove('hidden'); return; }
    if(emptyV) emptyV.classList.add('hidden'); if(contentV) contentV.classList.remove('hidden');

    let totalItens = 0; let custoRisco = 0; const divLista = document.getElementById('validade-lista-radar'); 
    dadosValidade.forEach(item => { totalItens += parseLocalFloat(item.quantidade); custoRisco += (parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo)); });

    if(document.getElementById('ui-validade-total')) document.getElementById('ui-validade-total').innerText = totalItens.toLocaleString('pt-BR');
    if(document.getElementById('ui-validade-custo')) document.getElementById('ui-validade-custo').innerText = 'R$ ' + custoRisco.toLocaleString('pt-BR', {minimumFractionDigits: 2});

    if(divLista) {
        divLista.innerHTML = '';
        const dadosOrdenados = [...dadosValidade].sort((a, b) => { const dA = String(a.data_validade).split('/').reverse().join(''); const dB = String(b.data_validade).split('/').reverse().join(''); return dA.localeCompare(dB); });

        dadosOrdenados.forEach(item => { 
            const riscoItem = parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo);
            const itemEncoded = encodeURIComponent(JSON.stringify(item));
            let dataVencimento; let partesData = String(item.data_validade).split('/');
            if (partesData.length === 3) { dataVencimento = new Date(partesData[2], partesData[1] - 1, partesData[0]); } else { dataVencimento = new Date(item.data_validade + 'T00:00:00'); }

            let hoje = new Date(); hoje.setHours(0,0,0,0);
            let diffTempo = dataVencimento.getTime() - hoje.getTime(); let diasRestantes = Math.ceil(diffTempo / (1000 * 3600 * 24));

            let corSinalizacao = "bg-emerald"; if (diasRestantes < 0) corSinalizacao = "bg-red-600 animate-pulse"; else if (diasRestantes <= 15) corSinalizacao = "bg-yellow-500";
            let dataExibicao = item.data_validade;
            if (dataExibicao && String(dataExibicao).includes('-')) { const p = String(dataExibicao).split('-'); if (p.length === 3) dataExibicao = `${p[2]}/${p[1]}/${p[0]}`; }

            const isRebaixado = item.rebaixado === 'SIM';
            const corCard = isRebaixado ? 'border-gold/50 bg-gold/5' : 'border-slate-200 bg-white';
            const corTextoCheck = isRebaixado ? 'text-gold' : 'text-slate-400';

            divLista.innerHTML += `<div class="p-3 mb-2 ${corCard} border rounded-lg flex flex-col md:flex-row md:items-center gap-3 shadow-sm min-w-0 transition-all"><div class="flex items-center gap-3 flex-1 min-w-0 text-left"><div class="w-3 h-3 rounded-full shrink-0 ${corSinalizacao}"></div><div class="flex-1 min-w-0"><p class="font-bold text-navy text-sm mb-1 truncate">${item.descricao || 'Produto'}</p><div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500"><span>Vence: <strong class="text-slate-700">${dataExibicao}</strong></span><span class="text-slate-300">|</span><span>GTIN: ${item.gtin || '-'}</span><span class="text-slate-300">|</span><span>Qtd: <strong class="text-slate-700">${item.quantidade} un</strong></span><span class="text-slate-300">|</span><span>Risco: <strong class="text-red-600">R$ ${riscoItem.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></span></div></div></div><div class="flex items-center justify-end gap-3 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-3 mt-2 md:mt-0"><label class="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold ${corTextoCheck} hover:text-gold transition-colors uppercase tracking-wider"><input type="checkbox" onchange="window.marcarRebaixaValidade('${itemEncoded}', this)" class="w-4 h-4 rounded border-slate-300 text-gold focus:ring-gold cursor-pointer" ${isRebaixado ? 'checked' : ''}> Rebaixado</label><button onclick="abrirModalAuditoria('${itemEncoded}')" class="bg-slate-50 hover:bg-slate-200 border border-slate-200 text-navy text-xs font-bold px-4 py-2 rounded-lg transition-colors whitespace-nowrap shadow-sm">Auditar</button></div></div>`;
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

window.marcarRebaixaValidade = async (itemEncoded, checkboxEl) => {
    const item = JSON.parse(decodeURIComponent(itemEncoded)); const statusRebaixa = checkboxEl.checked ? "SIM" : "NÃO";
    checkboxEl.disabled = true;
    const payload = { tipo: "atualizar_rebaixa_validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: item.filial, gtin: item.gtin, data_validade: item.data_validade, rebaixado: statusRebaixa };
    
    // Atualização otimista local
    const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(item.gtin) && i.data_validade === item.data_validade && i.filial === item.filial);
    if(idx > -1) sheetsDataRaw[idx].rebaixado = statusRebaixa;
    window.renderValidadeDashboard();

    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); } 
    catch(e) { alert("Erro de conexão."); checkboxEl.checked = !checkboxEl.checked; } finally { checkboxEl.disabled = false; }
};

window.renderFurtosDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-furtos')?.value; const filtroFilial = document.getElementById('filtro-filial-furtos')?.value;
    let dadosFurtos = sheetsDataRaw.filter(i => i.tipo === 'furto');
    if(filtroMes) dadosFurtos = dadosFurtos.filter(i => i.data_ocorrencia && extrairAnoMes(i.data_ocorrencia) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosFurtos = dadosFurtos.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    
    let totalRs = 0; let ocorrenciasMap = {}; let preventivas = 0; let generoMap = { 'Homem': 0, 'Mulher': 0, 'Outro': 0 }; let locaisMap = {};
    dadosFurtos.forEach(item => {
        totalRs += parseLocalFloat(item.subtotal); const chaveUnica = item.data_hora_registro + "_" + item.filial;
        if(!ocorrenciasMap[chaveUnica]) ocorrenciasMap[chaveUnica] = { abordagem: item.abordagem, genero: item.genero, local: item.local };
    });
    
    const ocorrencias = Object.values(ocorrenciasMap);
    ocorrencias.forEach(o => {
        if(String(o.abordagem).toLowerCase() === 'preventiva') preventivas++;
        if(generoMap[o.genero] !== undefined) generoMap[o.genero]++; else generoMap['Outro']++;
        const local = String(o.local).trim().toUpperCase(); if(!locaisMap[local]) locaisMap[local] = 0; locaisMap[local]++;
    });

    if(document.getElementById('ui-furto-total-rs')) document.getElementById('ui-furto-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-furto-total-ocorrencias')) document.getElementById('ui-furto-total-ocorrencias').innerText = ocorrencias.length;
    if(document.getElementById('ui-furto-preventivo')) document.getElementById('ui-furto-preventivo').innerText = (ocorrencias.length > 0 ? Math.round((preventivas / ocorrencias.length) * 100) : 0) + '%';

    const divChartPerfil = document.querySelector("#chart-furtos-perfil");
    if(divChartPerfil && typeof ApexCharts !== 'undefined') {
        if(chartFurtosPerfilInstance) chartFurtosPerfilInstance.destroy(); divChartPerfil.innerHTML = '';
        chartFurtosPerfilInstance = new ApexCharts(divChartPerfil, { series: Object.values(generoMap), labels: Object.keys(generoMap), chart: { type: 'donut', height: 260, fontFamily: 'Inter, sans-serif' }, colors:['#0A2540', '#008950', '#eab308'], dataLabels: { enabled: false }, legend: { position: 'bottom' } }); chartFurtosPerfilInstance.render();
    }
    const divChartLocais = document.querySelector("#chart-furtos-locais");
    if(divChartLocais && typeof ApexCharts !== 'undefined') {
        if(chartFurtosLocaisInstance) chartFurtosLocaisInstance.destroy(); divChartLocais.innerHTML = '';
        const locaisArray = Object.keys(locaisMap).map(k => ({ local: k, qtd: locaisMap[k] })).sort((a,b) => b.qtd - a.qtd).slice(0, 5);
        chartFurtosLocaisInstance = new ApexCharts(divChartLocais, { series:[{ name: 'Ocorrências', data: locaisArray.map(l => l.qtd) }], chart: { type: 'bar', height: 260, fontFamily: 'Inter, sans-serif', toolbar: { show: false } }, plotOptions: { bar: { borderRadius: 4, horizontal: true } }, dataLabels: { enabled: false }, xaxis: { categories: locaisArray.map(l => l.local) }, colors:['#dc2626'] }); chartFurtosLocaisInstance.render();
    }
};

window.renderPrecoDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-preco')?.value; const filtroFilial = document.getElementById('filtro-filial-preco')?.value;
    let dadosPreco = sheetsDataRaw.filter(i => i.tipo === 'auditoria_preco');
    if(filtroMes) dadosPreco = dadosPreco.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosPreco = dadosPreco.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    let divergentes = 0; let semPreco = 0;
    dadosPreco.forEach(item => { if (item.sem_preco === 'SIM') semPreco++; else if (parseLocalFloat(item.preco_sistema) !== parseLocalFloat(item.preco_gondola)) divergentes++; });
    if(document.getElementById('ui-preco-total')) document.getElementById('ui-preco-total').innerText = dadosPreco.length;
    if(document.getElementById('ui-preco-divergente')) document.getElementById('ui-preco-divergente').innerText = divergentes;
    if(document.getElementById('ui-preco-sempreco')) document.getElementById('ui-preco-sempreco').innerText = semPreco;
};

window.renderCaixaDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-caixa')?.value; const filtroFilial = document.getElementById('filtro-filial-caixa')?.value;
    let dadosCaixa = sheetsDataRaw.filter(i => i.tipo === 'caixa_central');
    if(filtroMes) dadosCaixa = dadosCaixa.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosCaixa = dadosCaixa.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    let totalRs = 0; dadosCaixa.forEach(item => { totalRs += parseLocalFloat(item.valor_falta); });
    if(document.getElementById('ui-caixa-total-ocorrencias')) document.getElementById('ui-caixa-total-ocorrencias').innerText = dadosCaixa.length;
    if(document.getElementById('ui-caixa-total-rs')) document.getElementById('ui-caixa-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
};

window.renderTarefasDashboard = () => {
    const divSis = document.getElementById('lista-tarefas-sistema'); const divMan = document.getElementById('lista-tarefas-manuais'); if(!divSis || !divMan) return;
    const filtroFilial = document.getElementById('filtro-filial-tar')?.value; let htmlSis = ''; let htmlMan = ''; const hoje = new Date(); hoje.setHours(0,0,0,0);
    
    let validades = sheetsDataRaw.filter(i => i.tipo === 'validade' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') validades = validades.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    validades.forEach(v => {
        let pData = String(v.data_validade).split('/'); let dVenc = pData.length === 3 ? new Date(pData[2], pData[1] - 1, pData[0]) : new Date(v.data_validade + 'T00:00:00'); let dias = Math.ceil((dVenc.getTime() - hoje.getTime()) / (1000 * 3600 * 24));
        if(dias <= 15 && dias >= 0) {
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
    checkboxEl.disabled = true; const titulo = decodeURIComponent(tituloEncoded); const parentDiv = checkboxEl.closest('.p-3.bg-slate-50'); if(parentDiv) parentDiv.style.opacity = '0.4';
    
    // Atualização otimista
    const idx = sheetsDataRaw.findIndex(x => x.tipo === 'tarefa' && x.titulo === titulo && x.filial === filial && x.status === 'PENDENTE');
    if(idx > -1) sheetsDataRaw[idx].status = 'CONCLUÍDA'; window.renderTarefasDashboard();
    
    const payload = { tipo: "concluir_tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, titulo: titulo };
    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); } 
    catch(e) { alert("Erro ao concluir."); checkboxEl.disabled = false; checkboxEl.checked = false; if(parentDiv) parentDiv.style.opacity = '1'; }
};

window.renderListaInventarios = () => {
    const tbody = document.getElementById('inv-tbody-consulta'); if(!tbody) return;
    const filtroFilial = document.getElementById('filtro-filial-inv')?.value;
    let inventarios = sheetsDataRaw.filter(i => i.tipo === 'inventario' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') inventarios = inventarios.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    
    const mapInv = {};
    inventarios.forEach(i => {
        if(!i.id_inventario) return;
        if(!mapInv[i.id_inventario]) mapInv[i.id_inventario] = { id: i.id_inventario, filial: i.filial, qtdLeituras: 0, fechado: false };
        if(i.status === 'FECHADO' || i.gtin === 'FECHAMENTO') mapInv[i.id_inventario].fechado = true; else if (i.gtin !== 'LISTA_DIRIGIDA') mapInv[i.id_inventario].qtdLeituras++;
    });

    const listaArr = Object.values(mapInv).sort((a,b) => { if (a.fechado !== b.fechado) return a.fechado ? 1 : -1; return b.id.localeCompare(a.id); });
    if(listaArr.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400 italic">Nenhum inventário localizado.</td></tr>'; return; }

    let html = '';
    listaArr.forEach(inv => {
        const statusBadge = inv.fechado ? `<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-slate-200"><i class="w-3 h-3 inline pb-0.5" data-lucide="lock"></i> Fechado</span>` : `<span class="bg-emerald/10 text-emerald px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-emerald/20"><i class="w-3 h-3 inline pb-0.5" data-lucide="unlock"></i> Aberto</span>`;
        const btnContinuar = !inv.fechado ? `<button type="button" onclick="abrirTelaBipagem('${inv.id}', '${inv.filial}')" class="text-xs bg-navy text-white hover:bg-navyLight px-3 py-1.5 rounded shadow-sm inline-flex items-center gap-1"><i class="w-3 h-3" data-lucide="scan-barcode"></i> Contar</button>` : '';
        const btnExportar = `<button type="button" onclick="exportarInventarioId('${inv.id}')" class="text-xs bg-white text-emerald border border-slate-200 px-3 py-1.5 rounded shadow-sm inline-flex items-center gap-1"><i class="w-3 h-3" data-lucide="file-spreadsheet"></i> Relatório</button>`;
        html += `<tr class="hover:bg-slate-50 transition-colors border-b border-slate-100"><td class="px-6 py-4 font-bold text-navy">${inv.id}</td><td class="px-6 py-4 text-slate-600 text-xs">${inv.filial}</td><td class="px-6 py-4">${statusBadge}</td><td class="px-6 py-4 text-center font-medium text-slate-700">${inv.qtdLeituras}</td><td class="px-6 py-4 text-right space-x-2">${btnContinuar} ${btnExportar}</td></tr>`;
    });
    tbody.innerHTML = html; if(window.lucide) lucide.createIcons();
};

window.abrirTelaBipagem = (idInv, filial) => { document.getElementById('inv-tela-selecao').classList.add('hidden'); document.getElementById('inv-tela-bipagem').classList.remove('hidden'); document.getElementById('ui-inv-id').innerText = idInv; document.getElementById('ui-inv-filial').innerText = filial; document.getElementById('inv-id-oculto').value = idInv; document.getElementById('inv-filial-oculto').value = filial; setTimeout(() => document.getElementById('inv-lote').focus(), 100); window.renderHistoricoBipagem(idInv); };
window.voltarTelaInventario = () => { document.getElementById('inv-tela-bipagem').classList.add('hidden'); document.getElementById('inv-tela-selecao').classList.remove('hidden'); window.renderListaInventarios(); };

window.iniciarNovoInventario = (event) => {
    const filial = document.getElementById('inv-nova-filial').value; if(!filial) { alert('Selecione a filial.'); return; }
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
    let busca = document.getElementById('inv-id-busca').value.trim().toUpperCase(); if(!busca) return; if(!busca.startsWith('INV-')) busca = 'INV-' + busca;
    const inventarios = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === busca);
    if(inventarios.length === 0) { alert('Não encontrado.'); return; }
    if(inventarios.some(i => i.status === 'FECHADO')) { alert('Inventário encerrado.'); return; }
    window.abrirTelaBipagem(busca, inventarios[0].filial);
};

window.encerrarInventarioAtual = async (event) => {
    const idInv = document.getElementById('inv-id-oculto').value; const filial = document.getElementById('inv-filial-oculto').value;
    if(!confirm(`Deseja encerrar o ${idInv}?`)) return;
    const btn = event.currentTarget; const txtOriginal = btn.innerHTML; btn.innerHTML = '<i class="w-4 h-4 animate-spin" data-lucide="loader-2"></i> Encerrando...';
    
    const payload = { tipo: "fechar_inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, id_inventario: idInv, nao_encontrados: [] };
    
    // Otimista
    sheetsDataRaw.push({ tipo: 'inventario', id_inventario: idInv, status: 'FECHADO', gtin: 'FECHAMENTO', filial: filial });
    window.voltarTelaInventario();
    
    try { await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload) }); sessionStorage.setItem(`lucroData_${currentUserFilial}`, JSON.stringify([...sheetsDataRaw, ...produtosMestre])); } 
    catch(err) { alert('Erro ao fechar no servidor.'); } finally { btn.innerHTML = txtOriginal; }
};

document.getElementById('form-inventario')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const idInv = document.getElementById('inv-id-oculto').value; const filial = document.getElementById('inv-filial-oculto').value; 
    const lote = document.getElementById('inv-lote').value.trim().toUpperCase(); const inputGtin = document.getElementById('inv-gtin'); const inputQtd = document.getElementById('inv-qtd');
    
    const payload = { tipo: "inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, lote: lote, gtin: inputGtin.value, descricao: document.getElementById('inv-desc')?.value || "", quantidade: inputQtd.value, id_inventario: idInv, status: "ABERTO" };
    
    // Submissão otimista via helper customizado
    submitToSheets(null, 'btn-save-inv', '', '', payload, '<i data-lucide="plus-square" class="w-5 h-5 text-gold"></i> Salvar Bipagem');
    
    inputGtin.value = ''; document.getElementById('inv-desc').value = ''; setTimeout(() => inputGtin.focus(), 100); 
    window.renderHistoricoBipagem(idInv);
});

window.renderHistoricoBipagem = (idInv) => {
    const divHist = document.getElementById('inv-historico-bipagem'); if(!divHist) return;
    const items = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv && i.gtin !== 'FECHAMENTO');
    const bipagens = items.filter(i => i.gtin !== 'LISTA_DIRIGIDA').reverse();

    if(bipagens.length === 0) { divHist.innerHTML = '<p class="text-xs text-slate-400 italic">Nenhum item bipado.</p>'; } 
    else { let html = ''; bipagens.slice(0, 15).forEach(i => { html += `<div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded mb-1"><div class="flex flex-col"><span class="text-xs font-bold text-navy">${i.descricao || i.gtin}</span><span class="text-[10px] text-slate-400">Lote: ${i.lote} | EAN: ${i.gtin}</span></div><span class="text-sm font-black text-emerald bg-emerald/10 px-2 py-1 rounded border border-emerald/20">${i.quantidade} un</span></div>`; }); divHist.innerHTML = html; }
};

window.exportarInventarioId = (idInv) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv);
    if(dataToExport.length === 0) { alert("Sem dados."); return; }
    const rows = []; rows.push(["Data do Registo", "Lote/Corredor", "GTIN", "Descrição", "Quantidade", "Status"].join(";"));
    dataToExport.forEach(item => { if (item.gtin === 'LISTA_DIRIGIDA' || item.gtin === 'FECHAMENTO') return; rows.push([`"${item.data_registro || ''}"`, `"${item.lote || 'Sem Lote'}"`, `"${item.gtin || ''}"`, `"${item.descricao || 'Produto'}"`, `${item.quantidade || 0}`, `"Contado"`].join(";")); });
    const csvContent = "\uFEFF" + rows.join("\n"); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.setAttribute("download", `Inventario_${idInv}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
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

document.getElementById('form-quebras')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const h = new Date(); const mF = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    const payload = { tipo: "quebra", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('q-filial-lancamento')?.value, mes: mF, gtin: document.getElementById('q-gtin')?.value||"", descricao: document.getElementById('q-desc')?.value||"", quantidade: document.getElementById('q-qtd')?.value||"", custo: document.getElementById('q-custo')?.value||"", motivo: document.getElementById('q-motivo')?.value||"" };
    submitToSheets(e.target, 'btn-save-quebra', 'msg-quebra-success', 'msg-quebra-error', payload, 'Enviar para Auditoria');
});

document.getElementById('form-recebimento')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return; 
    const payload = { tipo: "recebimento", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('r-filial-lancamento')?.value, data_entrega: document.getElementById('r-data')?.value||"", fornecedor: document.getElementById('r-fornecedor')?.value||"", nf: document.getElementById('r-nf')?.value||"", descricao: document.getElementById('r-desc')?.value||"", quantidade: document.getElementById('r-qtd')?.value||"", custo: document.getElementById('r-custo')?.value||"", motivo: document.getElementById('r-motivo')?.value||"", observacoes: document.getElementById('r-obs')?.value||"" };
    submitToSheets(e.target, 'btn-save-recebimento', 'msg-rec-success', 'msg-rec-error', payload, 'Enviar Registo');
});

document.getElementById('form-validade')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return; 
    const payload = { tipo: "validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('v-filial-lancamento')?.value, gtin: document.getElementById('v-gtin')?.value||"", descricao: document.getElementById('v-desc')?.value||"", categoria: document.getElementById('v-cat')?.value||"", quantidade: document.getElementById('v-qtd')?.value||"", custo: document.getElementById('v-custo')?.value||"", data_validade: document.getElementById('v-data')?.value||"" };
    submitToSheets(e.target, 'btn-save-validade', 'msg-val-success', 'msg-val-error', payload, 'Inserir no Radar');
});

document.getElementById('form-auditoria-preco')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return; 
    const payload = { tipo: "auditoria_preco", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('p-filial-lancamento')?.value, data_auditoria: document.getElementById('p-data')?.value, gtin: document.getElementById('p-gtin')?.value||"", descricao: document.getElementById('p-desc')?.value||"", preco_sistema: document.getElementById('p-sistema')?.value||"", preco_gondola: document.getElementById('p-gondola')?.value||"", sem_preco: document.getElementById('p-sem-preco')?.value||"NÃO" };
    await submitToSheets(e.target, 'btn-save-preco', 'msg-preco-success', 'msg-preco-error', payload, 'Enviar Auditoria');
});

document.getElementById('form-caixa-central')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return; 
    const payload = { tipo: "caixa_central", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('c-filial-lancamento')?.value, data_auditoria: document.getElementById('c-data')?.value||"", operador: document.getElementById('c-operador')?.value||"", tipo_divergencia: document.getElementById('c-tipo')?.value||"", valor_falta: document.getElementById('c-valor')?.value||"", observacoes: document.getElementById('c-obs')?.value||"" };
    submitToSheets(e.target, 'btn-save-caixa', 'msg-caixa-success', 'msg-caixa-error', payload, 'Registrar Falta');
});

document.getElementById('btn-add-prod')?.addEventListener('click', () => {
    const n = document.getElementById('f-prod-nome').value.trim(); const q = parseInt(document.getElementById('f-prod-qtd').value)||0; const p = parseFloat(document.getElementById('f-prod-preco').value.replace(',','.'))||0;
    if(!n || q <= 0 || p < 0) { alert("Preencha dados válidos."); return; }
    produtosFurto.push({ nome: n, qtd: q, preco: p }); document.getElementById('f-prod-nome').value = ''; document.getElementById('f-prod-qtd').value = ''; document.getElementById('f-prod-preco').value = '';
    const lP = document.getElementById('f-lista-produtos'); if(lP) lP.innerHTML += `<li class="flex justify-between items-center p-2 bg-white border border-slate-200 rounded mb-1 text-xs"><span class="font-bold text-navy truncate flex-1">${n}</span><span class="text-slate-500 w-16 text-center">${q} un</span><span class="text-red-600 font-bold w-24 text-right">R$ ${(q*p).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></li>`;
});

document.getElementById('form-furtos')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return; if (produtosFurto.length === 0) { alert("Adicione produtos."); return; }
    const payload = { tipo: "furto", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('f-filial')?.value, data_ocorrencia: document.getElementById('f-data')?.value||"", genero: document.getElementById('f-genero')?.value||"", idade: document.getElementById('f-idade')?.value||"", abordagem: document.getElementById('f-abordagem')?.value||"", local: document.getElementById('f-local')?.value||"", descricao: document.getElementById('f-desc')?.value||"", produtos: produtosFurto };
    await submitToSheets(e.target, 'btn-save-furto', 'msg-furto-success', 'msg-furto-error', payload, 'Registrar Sinistro');
    produtosFurto = []; const lP = document.getElementById('f-lista-produtos'); if(lP) lP.innerHTML = '';
});

document.getElementById('form-tarefas')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = { tipo: "tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('t-filial').value, titulo: document.getElementById('t-titulo').value, prazo: document.getElementById('t-prazo').value, status: 'PENDENTE' };
    await submitToSheets(e.target, 'btn-save-tar', 'msg-tar-success', '', payload, 'Criar Demanda');
});

document.getElementById('form-auditoria')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser || !itemEmAuditoria) return;
    const payload = { tipo: "atualizar_validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: currentUserFilial, gtin: itemEmAuditoria.gtin, descricao: itemEmAuditoria.descricao, data_validade: itemEmAuditoria.data_validade, quantidade: document.getElementById('modal-nova-qtd').value.replace(',', '.') };
    await submitToSheets(null, 'btn-save-auditoria', '', '', payload, 'Atualizar Posição'); document.getElementById('modal-auditoria').classList.add('hidden');
});

// ==========================================
// 7. VIEWS E NAVEGAÇÃO GERAL
// ==========================================
window.showView = (vN) => {
    ['portal-cliente', 'site-principal', 'auth-view', 'view-admin', 'view-client'].forEach(id => { const el = document.getElementById(id); if(el) { el.classList.add('hidden'); el.classList.remove('flex'); } });
    if(vN === 'site-principal') { const site = document.getElementById('site-principal'); if(site) site.classList.remove('hidden'); } 
    else {
        const portal = document.getElementById('portal-cliente'); if(portal) { portal.classList.remove('hidden'); portal.classList.add('flex'); }
        if(vN === 'login') { const auth = document.getElementById('auth-view'); if(auth) { auth.classList.remove('hidden'); auth.classList.add('flex'); } }
        if(vN === 'admin') { const admin = document.getElementById('view-admin'); if(admin) { admin.classList.remove('hidden'); admin.classList.add('flex'); } }
        if(vN === 'client') { const client = document.getElementById('view-client'); if(client) { client.classList.remove('hidden'); client.classList.add('flex'); } if(window.mudarEstadoSegmento) window.mudarEstadoSegmento('hub'); }
    }
    window.scrollTo(0, 0);
};

window.mudarEstadoSegmento = (est) => {
    const vc = document.getElementById('view-client'); if(vc) { vc.classList.remove('estado-hub', 'estado-varejo', 'estado-industria'); vc.classList.add('estado-' + est); }
    const cS = document.getElementById('container-segmentos'); const mV = document.getElementById('menu-abas'); const mI = document.getElementById('menu-abas-industria');
    if (est === 'hub') { if(mV) mV.classList.add('hidden'); if(mI) mI.classList.add('hidden'); if(cS) cS.classList.remove('hidden'); window.unselectAllTabs(); } 
    else if (est === 'varejo') { if(cS) cS.classList.add('hidden'); if(mI) mI.classList.add('hidden'); if(mV) mV.classList.remove('hidden'); document.getElementById('btn-tab-dash')?.click(); } 
};

window.unselectAllTabs = () => {
    ['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => { const el = document.getElementById(id); if(el) el.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-white text-slate-500 border border-slate-200 rounded-xl p-3 flex flex-col items-center shadow-sm hover:shadow-md hover:border-navy hover:text-navy transition-all gap-1"; });
    ['wrapper-tab-dash', 'wrapper-tab-form', 'wrapper-tab-recebimento', 'wrapper-tab-validade', 'wrapper-tab-furtos', 'wrapper-tab-preco', 'wrapper-tab-caixa', 'wrapper-tab-inv', 'wrapper-tab-tar'].forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
};

['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => {
    const b = document.getElementById(id);
    if(b) b.addEventListener('click', () => {
        window.unselectAllTabs(); b.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center shadow-md transition-all gap-1";
        const map = {'btn-tab-dash':'wrapper-tab-dash', 'btn-tab-form':'wrapper-tab-form', 'btn-tab-rec':'wrapper-tab-recebimento', 'btn-tab-val':'wrapper-tab-validade', 'btn-tab-furtos':'wrapper-tab-furtos', 'btn-tab-preco':'wrapper-tab-preco', 'btn-tab-caixa':'wrapper-tab-caixa', 'btn-tab-inv':'wrapper-tab-inv', 'btn-tab-tar':'wrapper-tab-tar'};
        document.getElementById(map[id])?.classList.remove('hidden');
    });
});
// Navegação das Abas do Painel Admin (Consultor)
const btnAdminUsers = document.getElementById('btn-admin-tab-users');
const btnAdminKpi = document.getElementById('btn-admin-tab-kpi');
const wrapAdminUsers = document.getElementById('admin-wrapper-tab-users');
const wrapAdminKpi = document.getElementById('admin-wrapper-tab-kpi');

if(btnAdminUsers && btnAdminKpi) {
    btnAdminUsers.addEventListener('click', () => {
        btnAdminUsers.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
        btnAdminKpi.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md";
        wrapAdminUsers.classList.remove('hidden');
        wrapAdminKpi.classList.add('hidden');
    });

    btnAdminKpi.addEventListener('click', () => {
        btnAdminKpi.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
        btnAdminUsers.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md";
        wrapAdminKpi.classList.remove('hidden');
        wrapAdminUsers.classList.add('hidden');
    });
}

// ==========================================
// 8. AUTENTICAÇÃO E HIERARQUIA
// ==========================================
const lF = document.getElementById('login-form');
if(lF) lF.addEventListener('submit', async (e) => { e.preventDefault(); document.getElementById('login-error-box')?.classList.add('hidden'); document.getElementById('login-loading')?.classList.remove('hidden'); try { await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (er) { document.getElementById('login-loading')?.classList.add('hidden'); document.getElementById('login-error-box')?.classList.remove('hidden'); document.getElementById('login-error-text').innerText = "Credenciais inválidas."; } }); 

document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', () => signOut(auth)));

onAuthStateChanged(auth, async (user) => {
    const loadBox = document.getElementById('login-loading'); if(loadBox) loadBox.classList.add('hidden');
    if (user) {
        if (document.getElementById('top-user-email')) document.getElementById('top-user-email').innerText = user.email;
        if (user.email === 'leandro@lucroseguro.com.br' || user.email.includes('leandro')) { window.showView('admin'); } 
        else {
            try {
                const docSnap = await getDoc(doc(db, 'users_permissions', user.email));
                if (docSnap.exists()) {
                    const p = docSnap.data(); currentUserEmpresa = p.company_name; currentUserFilial = p.unit_name; currentUserRole = p.role || 'operacional';
                    ['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial'].forEach(id => { const el = document.getElementById(id); if(el) { el.innerHTML = `<option value="${currentUserFilial}">${currentUserFilial}</option>`; el.value = currentUserFilial; } });
                    window.showView('client'); window.fetchSheetsDataComHierarquia(); 
                } else { signOut(auth); }
            } catch(e) { signOut(auth); }
        }
    } else { window.showView('site-principal'); }
});

if(window.location.hash === '#login') window.showView('login'); else window.showView('site-principal');

// ==========================================
// 9. MASTER DATA (AUTOCOMPLETAR GTIN)
// ==========================================
const autocompletarPorGtin = (gtin, inputsAlvo) => {
    const busca = String(gtin).replace(/[^0-9]/g, ''); if(busca.length === 0) return; 
    const produto = produtosMestre.find(p => p.gtin === busca);
    if(produto) {
        if(inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) document.getElementById(inputsAlvo.desc).value = produto.descricao || '';
        if(inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) document.getElementById(inputsAlvo.custo).value = produto.custo || '';
        if(inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) document.getElementById(inputsAlvo.preco).value = produto.preco || '';
    }
};

[{ gtinId: 'inv-gtin', alvos: { desc: 'inv-desc' } }, { gtinId: 'q-gtin', alvos: { desc: 'q-desc', custo: 'q-custo' } }, { gtinId: 'p-gtin', alvos: { desc: 'p-desc', preco: 'p-sistema' } }, { gtinId: 'v-gtin', alvos: { desc: 'v-desc', custo: 'v-custo' } }].forEach(mapa => {
    const inputEan = document.getElementById(mapa.gtinId);
    if(inputEan) { inputEan.addEventListener('change', (e) => autocompletarPorGtin(e.target.value, mapa.alvos)); inputEan.addEventListener('blur', (e) => autocompletarPorGtin(e.target.value, mapa.alvos)); }
});
// ==========================================
// 10. MOTOR DO PAINEL ADMIN (VISÃO DE CONSULTOR)
// ==========================================
document.getElementById('btn-switch-client')?.addEventListener('click', async () => {
    // 1. Pega o e-mail que o consultor digitou no campo
    const emailAlvo = document.getElementById('input-client-email')?.value.trim();
    
    if(!emailAlvo) {
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
            
            // Atualiza os formulários ocultos para lançarem na filial certa
            ['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial'].forEach(id => { 
                const el = document.getElementById(id); 
                if(el) { el.innerHTML = `<option value="${currentUserFilial}">${currentUserFilial}</option>`; el.value = currentUserFilial; } 
            });

            // 4. Mostra o botão dourado "Visão Consultor" para você poder voltar
            const btnVoltarAdmin = document.getElementById('btn-switch-admin');
            if(btnVoltarAdmin) {
                btnVoltarAdmin.style.display = 'block';
                btnVoltarAdmin.onclick = () => { 
                    window.showView('admin'); 
                    btnVoltarAdmin.style.display = 'none';
                    document.getElementById('top-user-email').innerText = auth.currentUser.email;
                };
            }

            // Identifica no cabeçalho que você está a espiar a conta do cliente
            const topUser = document.getElementById('top-user-email');
            if(topUser) topUser.innerText = emailAlvo + " (Visão Consultor)";
            
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
        if(window.lucide) window.lucide.createIcons();
    }
});
