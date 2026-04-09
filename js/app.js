// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, serverTimestamp, doc, setDoc, getDoc, getDocs, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

const GOOGLE_SHEETS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxmr0Y-4fq5OigxSxSMaAqnXTDiM7ekaL9EA7j1Bzf-zyQ311qoE7elqAoIYgoFT_EhJg/exec"; 
const ADMIN_EMAIL = 'leandro@lucroseguro.com.br';

let chartMotivosInstance = null;
let chartFurtosPerfilInstance = null;
let chartFurtosLocaisInstance = null;
let sheetsDataRaw = []; 
let produtosMestre = []; 
let unsubscribeDb = null;
let itemEmAuditoria = null;
let produtosFurto = []; 
let currentUserEmpresa = "";
let currentUserFilial = "";
let currentUserRole = "operacional";

lucide.createIcons();

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

const exportDataToCSV = (tipo, filename) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === tipo);
    if(dataToExport.length === 0) { alert("Sem dados processados para exportar."); return; }
    const headers = Object.keys(dataToExport[0]).join(";");
    const rows = dataToExport.map(obj => Object.values(obj).map(val => `"${String(val).replace(/"/g, '""')}"`).join(";")).join("\n");
    const csvContent = "\uFEFF" + headers + "\n" + rows; 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename + "_" + currentUserFilial.replace(/[^a-zA-Z0-9]/g, '') + ".csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const submitToSheets = async (form, btnId, msgSuccessId, msgErrorId, payload, btnOriginalText) => {
    const btn = document.getElementById(btnId);
    const msgSuccess = document.getElementById(msgSuccessId);
    const msgError = document.getElementById(msgErrorId);
    
    if(btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A enviar...'; }
    if(msgSuccess) msgSuccess.classList.add('hidden');
    if(msgError) msgError.classList.add('hidden');
    lucide.createIcons();
    
    try {
        const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
            method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            if (payload.tipo === 'atualizar_validade') {
                const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(payload.gtin) && i.data_validade === payload.data_validade);
                if (idx !== -1) {
                    if (parseFloat(payload.quantidade) <= 0) sheetsDataRaw.splice(idx, 1);
                    else sheetsDataRaw[idx].quantidade = payload.quantidade;
                }
            } 
            if(form) form.reset();
            if(msgSuccess) { msgSuccess.classList.remove('hidden'); setTimeout(() => msgSuccess.classList.add('hidden'), 5000); }
            fetchSheetsDataComHierarquia();
        } else {
            throw new Error(result.message || "Erro desconhecido na planilha.");
        }
    } catch (error) {
        if(msgError) { msgError.innerText = error.message; msgError.classList.remove('hidden'); }
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = btnOriginalText; } lucide.createIcons();
    }
};

window.fetchSheetsDataComHierarquia = async () => {
    const loadingQ = document.getElementById('loading-quebras');
    const loadingMain = document.getElementById('loading-data');
    if(loadingQ) loadingQ.classList.remove('hidden');
    if(loadingMain) loadingMain.classList.remove('hidden');
    
    sheetsDataRaw = []; 
    try {
        const userEmailReq = auth.currentUser ? auth.currentUser.email : 'anonimo';
        const urlSegura = `${GOOGLE_SHEETS_WEBAPP_URL}?empresa=${encodeURIComponent(currentUserEmpresa)}&filial=${encodeURIComponent(currentUserFilial)}&role=${encodeURIComponent(currentUserRole)}&user=${encodeURIComponent(userEmailReq)}&t=${Date.now()}`;
        
        const res = await fetch(urlSegura);
        const data = await res.json();
        if(data && Array.isArray(data)) {
            sheetsDataRaw = data.filter(i => i.tipo !== 'produto');
            produtosMestre = data.filter(i => i.tipo === 'produto');
        }
    } catch(e) {
        console.error("Erro ao buscar dados do Sheets:", e);
    } finally {
        const hoje = new Date();
        const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        
        const filtroQuebra = document.getElementById('filtro-mes-quebra');
        const filQ = document.getElementById('filtro-filial-quebra');
        if(filtroQuebra) { if(!filtroQuebra.value) filtroQuebra.value = mesAtual; filtroQuebra.onchange = () => renderQuebrasDashboard(); }
        if(filQ) { filQ.onchange = () => renderQuebrasDashboard(); }

        const filtroDocas = document.getElementById('filtro-mes-docas');
        const filD = document.getElementById('filtro-filial-docas');
        if(filtroDocas) { if(!filtroDocas.value) filtroDocas.value = mesAtual; filtroDocas.onchange = () => renderDocasDashboard(); }
        if(filD) { filD.onchange = () => renderDocasDashboard(); }

        const filV = document.getElementById('filtro-filial-validade');
        if(filV) { filV.onchange = () => renderValidadeDashboard(); }

        const filtroFurtos = document.getElementById('filtro-mes-furtos');
        const filFurtos = document.getElementById('filtro-filial-furtos');
        if(filtroFurtos) { if(!filtroFurtos.value) filtroFurtos.value = mesAtual; filtroFurtos.onchange = () => renderFurtosDashboard(); }
        if(filFurtos) { filFurtos.onchange = () => renderFurtosDashboard(); }

        const filtroPreco = document.getElementById('filtro-mes-preco');
        const filPreco = document.getElementById('filtro-filial-preco');
        if(filtroPreco) { if(!filtroPreco.value) filtroPreco.value = mesAtual; filtroPreco.onchange = () => renderPrecoDashboard(); }
        if(filPreco) { filPreco.onchange = () => renderPrecoDashboard(); }

        const filtroCaixa = document.getElementById('filtro-mes-caixa');
        const filCaixa = document.getElementById('filtro-filial-caixa');
        if(filtroCaixa) { if(!filtroCaixa.value) filtroCaixa.value = mesAtual; filtroCaixa.onchange = () => renderCaixaDashboard(); }
        if(filCaixa) { filCaixa.onchange = () => renderCaixaDashboard(); }
        
        const filInv = document.getElementById('filtro-filial-inv');
        if(filInv) { filInv.onchange = () => renderListaInventarios(); }

        const filTar = document.getElementById('filtro-filial-tar');
        if(filTar) { filTar.onchange = () => renderTarefasDashboard(); }

        try { renderQuebrasDashboard(); } catch(e) {}
        try { renderPrecoDashboard(); } catch(e) {}
        try { renderDocasDashboard(); } catch(e) {}
        try { renderValidadeDashboard(); } catch(e) {}
        try { renderFurtosDashboard(); } catch(e) {}
        try { renderCaixaDashboard(); } catch(e) {}
        try { renderTarefasDashboard(); } catch(e) {}
        try { renderInventarioDashboard(); } catch(e) {}

        if(loadingQ) loadingQ.classList.add('hidden');
        if(loadingMain) loadingMain.classList.add('hidden');
    }
};

window.renderQuebrasDashboard = () => {
    const contentQ = document.getElementById('quebras-dashboard-content');
    const emptyQ = document.getElementById('empty-state-quebras');
    const filtroMes = document.getElementById('filtro-mes-quebra')?.value;
    const filtroFilial = document.getElementById('filtro-filial-quebra')?.value;
    if(!filtroMes) return;
    let dadosMes = sheetsDataRaw.filter(i => i.tipo === 'quebra' && i.mes && extrairAnoMes(i.mes) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosMes = dadosMes.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosMes.length === 0) { 
        if(contentQ) contentQ.classList.add('hidden'); 
        if(emptyQ) emptyQ.classList.remove('hidden'); 
        return; 
    }
    if(emptyQ) emptyQ.classList.add('hidden'); 
    if(contentQ) contentQ.classList.remove('hidden');
    
    let totalRs = 0; let totalQtd = 0; const motivosMap = {}; const rankingMap = {};
    dadosMes.forEach(item => { 
        const qtd = parseLocalFloat(item.quantidade); const custo = parseLocalFloat(item.custo); const valorTotal = qtd * custo; 
        const motivo = item.motivo || 'Outros'; const produto = item.descricao || 'Produto sem nome';
        totalRs += valorTotal; totalQtd += qtd; 
        if(!motivosMap[motivo]) motivosMap[motivo] = 0; motivosMap[motivo] += valorTotal; 
        if(!rankingMap[produto]) rankingMap[produto] = 0; rankingMap[produto] += valorTotal;
    });

    if(document.getElementById('ui-quebra-total-rs')) document.getElementById('ui-quebra-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-quebra-total-qtd')) document.getElementById('ui-quebra-total-qtd').innerText = totalQtd.toLocaleString('pt-BR');

    const divChart = document.querySelector("#chart-quebras-motivos") || document.querySelector("#chart-motivos"); 
    if(divChart && typeof ApexCharts !== 'undefined') {
        if(chartMotivosInstance) chartMotivosInstance.destroy(); 
        const options = {
            series: Object.values(motivosMap), labels: Object.keys(motivosMap),
            chart: { type: 'donut', height: 280, fontFamily: 'Inter, sans-serif' },
            colors:['#0A2540', '#008950', '#f97316', '#eab308', '#ef4444', '#8b5cf6'], 
            dataLabels: { enabled: false }, legend: { position: 'right' },
            tooltip: { y: { formatter: function (val) { return "R$ " + val.toLocaleString('pt-BR', {minimumFractionDigits: 2}); } } }
        };
        chartMotivosInstance = new ApexCharts(divChart, options); chartMotivosInstance.render();
    }

    const divRanking = document.getElementById('ranking-quebras-list') || document.getElementById('ranking-list');
    if(divRanking) {
        const rankingArray = Object.keys(rankingMap).map(key => ({ produto: key, valor: rankingMap[key] })).sort((a, b) => b.valor - a.valor);
        divRanking.innerHTML = '';
        rankingArray.slice(0, 5).forEach((item, index) => {
            divRanking.innerHTML += `<div class="flex justify-between items-center p-3 hover:bg-slate-50 rounded-lg transition-colors border-b border-slate-100 last:border-0"><div class="flex items-center gap-3"><span class="text-lg font-bold text-slate-300 w-5">${index + 1}º</span><span class="font-medium text-slate-700">${item.produto}</span></div><span class="font-bold text-red-600">R$ ${item.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>`;
        });
    }
};

window.renderDocasDashboard = () => {
    const contentD = document.getElementById('docas-dashboard-content');
    const emptyD = document.getElementById('empty-state-docas');
    const filtroMes = document.getElementById('filtro-mes-docas')?.value;
    const filtroFilial = document.getElementById('filtro-filial-docas')?.value;
    let dadosDocas = sheetsDataRaw.filter(i => i.tipo === 'recebimento');
    
    if (filtroMes) dadosDocas = dadosDocas.filter(i => extrairAnoMes(i.data_entrega) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosDocas = dadosDocas.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosDocas.length === 0) { 
        if(contentD) contentD.classList.add('hidden'); 
        if(emptyD) emptyD.classList.remove('hidden'); 
        return; 
    }
    if(emptyD) emptyD.classList.add('hidden'); 
    if(contentD) contentD.classList.remove('hidden');

    const divLista = document.getElementById('docas-lista-divergencias'); 
    let totalDivergencias = 0; let custoDivergencias = 0;

    dadosDocas.forEach(item => {
        totalDivergencias += parseLocalFloat(item.quantidade);
        custoDivergencias += (parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo));
    });

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
    const contentV = document.getElementById('validade-dashboard-content');
    const emptyV = document.getElementById('empty-state-validade');
    const filtroFilial = document.getElementById('filtro-filial-validade')?.value;
    let dadosValidade = sheetsDataRaw.filter(i => i.tipo === 'validade');
    
    if(filtroFilial && filtroFilial !== 'todas') dadosValidade = dadosValidade.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    if(dadosValidade.length === 0) { 
        if(contentV) contentV.classList.add('hidden'); 
        if(emptyV) emptyV.classList.remove('hidden'); 
        return; 
    }
    if(emptyV) emptyV.classList.add('hidden'); 
    if(contentV) contentV.classList.remove('hidden');

    const divLista = document.getElementById('validade-lista-radar'); 
    let totalItens = 0; let custoRisco = 0;

    dadosValidade.forEach(item => {
        totalItens += parseLocalFloat(item.quantidade);
        custoRisco += (parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo));
    });

    if(document.getElementById('ui-validade-total')) document.getElementById('ui-validade-total').innerText = totalItens.toLocaleString('pt-BR');
    if(document.getElementById('ui-validade-custo')) document.getElementById('ui-validade-custo').innerText = 'R$ ' + custoRisco.toLocaleString('pt-BR', {minimumFractionDigits: 2});

    if(divLista) {
        divLista.innerHTML = '';
        const dadosOrdenados = [...dadosValidade].sort((a, b) => {
            const dataA = String(a.data_validade).split('/').reverse().join('');
            const dataB = String(b.data_validade).split('/').reverse().join('');
            return dataA.localeCompare(dataB);
        });

        dadosOrdenados.forEach(item => { 
            const riscoItem = parseLocalFloat(item.quantidade) * parseLocalFloat(item.custo);
            const itemEncoded = encodeURIComponent(JSON.stringify(item));

            let dataVencimento;
            let partesData = String(item.data_validade).split('/');
            if (partesData.length === 3) { dataVencimento = new Date(partesData[2], partesData[1] - 1, partesData[0]); } 
            else { dataVencimento = new Date(item.data_validade + 'T00:00:00'); }
            
            let hoje = new Date(); hoje.setHours(0,0,0,0);
            let diffTempo = dataVencimento.getTime() - hoje.getTime();
            let diasRestantes = Math.ceil(diffTempo / (1000 * 3600 * 24));

            let corSinalizacao = "bg-emerald"; 
            if (diasRestantes < 0) corSinalizacao = "bg-red-600 animate-pulse"; 
            else if (diasRestantes <= 15) corSinalizacao = "bg-yellow-500"; 

            let dataExibicao = item.data_validade;
            if (dataExibicao && String(dataExibicao).includes('-')) {
                const partes = String(dataExibicao).split('-');
                if (partes.length === 3) dataExibicao = `${partes[2]}/${partes[1]}/${partes[0]}`;
            }

            const isRebaixado = item.rebaixado === 'SIM';
            const corCard = isRebaixado ? 'border-gold/50 bg-gold/5' : 'border-slate-200 bg-white';
            const corTextoCheck = isRebaixado ? 'text-gold' : 'text-slate-400';

            divLista.innerHTML += `
                <div class="p-3 mb-2 ${corCard} border rounded-lg flex flex-col md:flex-row md:items-center gap-3 shadow-sm min-w-0 transition-all">
                    <div class="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <div class="w-3 h-3 rounded-full shrink-0 ${corSinalizacao}"></div>
                        <div class="flex-1 min-w-0">
                            <p class="font-bold text-navy text-sm mb-1 truncate">${item.descricao || 'Produto'}</p>
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                <span>Vence: <strong class="text-slate-700">${dataExibicao}</strong></span>
                                <span class="text-slate-300">|</span>
                                <span>GTIN: ${item.gtin || '-'}</span>
                                <span class="text-slate-300">|</span>
                                <span>Qtd: <strong class="text-slate-700">${item.quantidade} un</strong></span>
                                <span class="text-slate-300">|</span>
                                <span>Risco: <strong class="text-red-600">R$ ${riscoItem.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center justify-end gap-3 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-3 mt-2 md:mt-0">
                        <label class="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold ${corTextoCheck} hover:text-gold transition-colors uppercase tracking-wider">
                            <input type="checkbox" onchange="window.marcarRebaixaValidade('${itemEncoded}', this)" class="w-4 h-4 rounded border-slate-300 text-gold focus:ring-gold cursor-pointer" ${isRebaixado ? 'checked' : ''}>
                            Rebaixado
                        </label>
                        <button onclick="window.abrirModalAuditoria('${itemEncoded}')" class="bg-slate-50 hover:bg-slate-200 border border-slate-200 text-navy text-xs font-bold px-4 py-2 rounded-lg transition-colors whitespace-nowrap shadow-sm">
                            Auditar
                        </button>
                    </div>
                </div>
            `;
        });
        setTimeout(() => { if(window.lucide) window.lucide.createIcons(); }, 50);
    }
};

window.renderFurtosDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-furtos')?.value;
    const filtroFilial = document.getElementById('filtro-filial-furtos')?.value;
    let dadosFurtos = sheetsDataRaw.filter(i => i.tipo === 'furto');
    
    if(filtroMes) {
        dadosFurtos = dadosFurtos.filter(i => i.data_ocorrencia && extrairAnoMes(i.data_ocorrencia) === filtroMes);
    }
    if(filtroFilial && filtroFilial !== 'todas') {
        dadosFurtos = dadosFurtos.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    }
    
    let totalRs = 0;
    let ocorrenciasMap = {}; 

    dadosFurtos.forEach(item => {
        totalRs += parseLocalFloat(item.subtotal);
        const chaveUnica = item.data_hora_registro + "_" + item.filial;
        if(!ocorrenciasMap[chaveUnica]) {
            ocorrenciasMap[chaveUnica] = { abordagem: item.abordagem, genero: item.genero, local: item.local };
        }
    });

    const ocorrencias = Object.values(ocorrenciasMap);
    const totalOcorrencias = ocorrencias.length;

    let preventivas = 0;
    let generoMap = { 'Homem': 0, 'Mulher': 0, 'Outro': 0 };
    let locaisMap = {};

    ocorrencias.forEach(o => {
        if(String(o.abordagem).toLowerCase() === 'preventiva') preventivas++;
        if(generoMap[o.genero] !== undefined) generoMap[o.genero]++;
        else generoMap['Outro']++;

        const local = String(o.local).trim().toUpperCase();
        if(!locaisMap[local]) locaisMap[local] = 0;
        locaisMap[local]++;
    });

    const percPreventivo = totalOcorrencias > 0 ? Math.round((preventivas / totalOcorrencias) * 100) : 0;

    if(document.getElementById('ui-furto-total-rs')) document.getElementById('ui-furto-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    if(document.getElementById('ui-furto-total-ocorrencias')) document.getElementById('ui-furto-total-ocorrencias').innerText = totalOcorrencias;
    if(document.getElementById('ui-furto-preventivo')) document.getElementById('ui-furto-preventivo').innerText = percPreventivo + '%';

    const divChartPerfil = document.querySelector("#chart-furtos-perfil");
    if(divChartPerfil && typeof ApexCharts !== 'undefined') {
        if(chartFurtosPerfilInstance) chartFurtosPerfilInstance.destroy();
        divChartPerfil.innerHTML = '';
        const optionsPerfil = {
            series: Object.values(generoMap),
            labels: Object.keys(generoMap),
            chart: { type: 'donut', height: 260, fontFamily: 'Inter, sans-serif' },
            colors:['#0A2540', '#008950', '#eab308'],
            dataLabels: { enabled: false },
            legend: { position: 'bottom' }
        };
        chartFurtosPerfilInstance = new ApexCharts(divChartPerfil, optionsPerfil);
        chartFurtosPerfilInstance.render();
    }

    const divChartLocais = document.querySelector("#chart-furtos-locais");
    if(divChartLocais && typeof ApexCharts !== 'undefined') {
        if(chartFurtosLocaisInstance) chartFurtosLocaisInstance.destroy();
        divChartLocais.innerHTML = '';
        const locaisArray = Object.keys(locaisMap).map(k => ({ local: k, qtd: locaisMap[k] })).sort((a,b) => b.qtd - a.qtd).slice(0, 5);
        const optionsLocais = {
            series:[{ name: 'Ocorrências', data: locaisArray.map(l => l.qtd) }],
            chart: { type: 'bar', height: 260, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
            plotOptions: { bar: { borderRadius: 4, horizontal: true } },
            dataLabels: { enabled: false },
            xaxis: { categories: locaisArray.map(l => l.local) },
            colors:['#dc2626']
        };
        chartFurtosLocaisInstance = new ApexCharts(divChartLocais, optionsLocais);
        chartFurtosLocaisInstance.render();
    }
};

document.getElementById('btn-export-csv')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('quebra', 'Quebras'); });
document.getElementById('btn-export-csv-docas')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('recebimento', 'Docas'); });
document.getElementById('btn-export-csv-val')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('validade', 'Validades'); });
document.getElementById('btn-export-csv-furtos')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('furto', 'Furtos_Evitados'); });

document.getElementById('form-quebras')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const selectFilial = document.getElementById('q-filial-lancamento');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;
    const dataAtual = new Date();
    const mesAuto = `${dataAtual.getFullYear()}-${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;
    const campoMes = document.getElementById('q-mes');
    let mesFormatado = campoMes && campoMes.value ? campoMes.value.substring(0, 7) : mesAuto;

    const payload = { tipo: "quebra", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, mes: mesFormatado, gtin: document.getElementById('q-gtin')?.value || "", descricao: document.getElementById('q-desc')?.value || "", quantidade: document.getElementById('q-qtd')?.value || "", custo: document.getElementById('q-custo')?.value || "", motivo: document.getElementById('q-motivo')?.value || "" };
    submitToSheets(e.target, 'btn-save-quebra', 'msg-quebra-success', 'msg-quebra-error', payload, '<i data-lucide="send" class="w-5 h-5"></i> Enviar para Auditoria');
});

document.getElementById('form-recebimento')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const selectFilial = document.getElementById('r-filial-lancamento');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;

    const payload = { tipo: "recebimento", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, data_entrega: document.getElementById('r-data')?.value || "", fornecedor: document.getElementById('r-fornecedor')?.value || "", nf: document.getElementById('r-nf')?.value || "", descricao: document.getElementById('r-desc')?.value || "", quantidade: document.getElementById('r-qtd')?.value || "", custo: document.getElementById('r-custo')?.value || "", motivo: document.getElementById('r-motivo')?.value || "", observacoes: document.getElementById('r-obs')?.value || "" };
    submitToSheets(e.target, 'btn-save-recebimento', 'msg-rec-success', 'msg-rec-error', payload, '<i data-lucide="send" class="w-5 h-5"></i> Enviar Registo de Docas');
});

document.getElementById('form-validade')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const selectFilial = document.getElementById('v-filial-lancamento');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;

    const payload = { tipo: "validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, gtin: document.getElementById('v-gtin')?.value || "", descricao: document.getElementById('v-desc')?.value || "", categoria: document.getElementById('v-cat')?.value || "", quantidade: document.getElementById('v-qtd')?.value || "", custo: document.getElementById('v-custo')?.value || "", data_validade: document.getElementById('v-data')?.value || "" };
    submitToSheets(e.target, 'btn-save-validade', 'msg-val-success', 'msg-val-error', payload, '<i data-lucide="bell-ring" class="w-5 h-5"></i> Inserir no Radar');
});

document.getElementById('btn-export-csv-preco')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('auditoria_preco', 'Auditoria_Precos'); });

document.getElementById('form-auditoria-preco')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const selectFilial = document.getElementById('p-filial-lancamento');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;
    
    const inputData = document.getElementById('p-data');
    const dataSalva = inputData ? inputData.value : "";
    
    const payload = { 
        tipo: "auditoria_preco", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, 
        data_auditoria: dataSalva,
        gtin: document.getElementById('p-gtin')?.value || "", 
        descricao: document.getElementById('p-desc')?.value || "", 
        preco_sistema: document.getElementById('p-sistema')?.value || "", 
        preco_gondola: document.getElementById('p-gondola')?.value || "", 
        sem_preco: document.getElementById('p-sem-preco')?.value || "NÃO" 
    };
    
    await submitToSheets(e.target, 'btn-save-preco', 'msg-preco-success', 'msg-preco-error', payload, '<i data-lucide="send" class="w-5 h-5"></i> Enviar Auditoria');
    if(inputData) inputData.value = dataSalva;
    
    const inputGtin = document.getElementById('p-gtin');
    if(inputGtin) setTimeout(() => inputGtin.focus(), 100);
});

window.renderPrecoDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-preco')?.value;
    const filtroFilial = document.getElementById('filtro-filial-preco')?.value;
    let dadosPreco = sheetsDataRaw.filter(i => i.tipo === 'auditoria_preco');
    
    if(filtroMes) dadosPreco = dadosPreco.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosPreco = dadosPreco.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    let totalAuditoria = dadosPreco.length;
    let divergentes = 0;
    let semPreco = 0;

    dadosPreco.forEach(item => {
        if (item.sem_preco === 'SIM') {
            semPreco++;
        } else {
            const sis = parseLocalFloat(item.preco_sistema);
            const gon = parseLocalFloat(item.preco_gondola);
            if (sis !== gon) divergentes++;
        }
    });

    if(document.getElementById('ui-preco-total')) document.getElementById('ui-preco-total').innerText = totalAuditoria;
    if(document.getElementById('ui-preco-divergente')) document.getElementById('ui-preco-divergente').innerText = divergentes;
    if(document.getElementById('ui-preco-sempreco')) document.getElementById('ui-preco-sempreco').innerText = semPreco;
};

document.getElementById('btn-export-csv-caixa')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('caixa_central', 'Caixa_Central'); });

document.getElementById('form-caixa-central')?.addEventListener('submit', (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const selectFilial = document.getElementById('c-filial-lancamento');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;
    
    const payload = { 
        tipo: "caixa_central", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, 
        data_auditoria: document.getElementById('c-data')?.value || "",
        operador: document.getElementById('c-operador')?.value || "", 
        tipo_divergencia: document.getElementById('c-tipo')?.value || "", 
        valor_falta: document.getElementById('c-valor')?.value || "", 
        observacoes: document.getElementById('c-obs')?.value || "" 
    };
    submitToSheets(e.target, 'btn-save-caixa', 'msg-caixa-success', 'msg-caixa-error', payload, '<i data-lucide="send" class="w-5 h-5"></i> Registrar Quebra de Caixa');
});

window.renderCaixaDashboard = () => {
    const filtroMes = document.getElementById('filtro-mes-caixa')?.value;
    const filtroFilial = document.getElementById('filtro-filial-caixa')?.value;
    let dadosCaixa = sheetsDataRaw.filter(i => i.tipo === 'caixa_central');
    
    if(filtroMes) dadosCaixa = dadosCaixa.filter(i => i.data_auditoria && extrairAnoMes(i.data_auditoria) === filtroMes);
    if(filtroFilial && filtroFilial !== 'todas') dadosCaixa = dadosCaixa.filter(i => String(i.filial).trim() === String(filtroFilial).trim());

    let totalRs = 0;
    let ocorrencias = dadosCaixa.length;

    dadosCaixa.forEach(item => {
        totalRs += parseLocalFloat(item.valor_falta);
    });

    if(document.getElementById('ui-caixa-total-ocorrencias')) document.getElementById('ui-caixa-total-ocorrencias').innerText = ocorrencias;
    if(document.getElementById('ui-caixa-total-rs')) document.getElementById('ui-caixa-total-rs').innerText = 'R$ ' + totalRs.toLocaleString('pt-BR', {minimumFractionDigits: 2});
};

const btnAddProd = document.getElementById('btn-add-prod');
const listaProdUI = document.getElementById('f-lista-produtos');

const renderProdutosFurto = () => {
    if(!listaProdUI) return;
    listaProdUI.innerHTML = '';
    produtosFurto.forEach((p, index) => {
        const subtotal = p.qtd * p.preco;
        listaProdUI.innerHTML += `
            <li class="flex justify-between items-center p-2 bg-white border border-slate-200 rounded mb-1 text-xs shadow-sm">
                <span class="font-bold text-navy truncate flex-1">${p.nome}</span>
                <span class="text-slate-500 w-16 text-center">${p.qtd} un</span>
                <span class="text-red-600 font-bold w-24 text-right">R$ ${subtotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                <button type="button" onclick="removerProdutoFurto(${index})" class="ml-3 text-slate-300 hover:text-red-500 transition-colors">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </li>
        `;
    });
    if(window.lucide) window.lucide.createIcons();
};

if(btnAddProd) {
    btnAddProd.addEventListener('click', () => {
        const nome = document.getElementById('f-prod-nome').value.trim();
        const qtd = parseInt(document.getElementById('f-prod-qtd').value) || 0;
        const preco = parseFloat(document.getElementById('f-prod-preco').value.replace(',', '.')) || 0;

        if(!nome || qtd <= 0 || preco < 0) { alert("Preencha o nome do produto, uma quantidade válida e o preço."); return; }

        produtosFurto.push({ nome, qtd, preco });
        document.getElementById('f-prod-nome').value = '';
        document.getElementById('f-prod-qtd').value = '';
        document.getElementById('f-prod-preco').value = '';
        document.getElementById('f-prod-nome').focus();
        renderProdutosFurto();
    });
}

window.removerProdutoFurto = (index) => {
    produtosFurto.splice(index, 1);
    renderProdutosFurto();
};

document.getElementById('form-furtos')?.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    if (!auth.currentUser) return;
    
    if (produtosFurto.length === 0) {
        alert("Atenção: Você precisa adicionar pelo menos um produto na lista de recuperados antes de salvar.");
        return;
    }

    const selectFilial = document.getElementById('f-filial');
    const filialSelecionada = selectFilial && selectFilial.value ? selectFilial.value : currentUserFilial;

    const payload = { 
        tipo: "furto", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filialSelecionada, 
        data_ocorrencia: document.getElementById('f-data')?.value || "", 
        genero: document.getElementById('f-genero')?.value || "", 
        idade: document.getElementById('f-idade')?.value || "", 
        abordagem: document.getElementById('f-abordagem')?.value || "", 
        local: document.getElementById('f-local')?.value || "", 
        descricao: document.getElementById('f-desc')?.value || "",
        produtos: produtosFurto 
    };
    
    await submitToSheets(e.target, 'btn-save-furto', 'msg-furto-success', 'msg-furto-error', payload, '<i data-lucide="save" class="w-5 h-5 text-gold"></i> Registrar Sinistro');
    
    produtosFurto = [];
    renderProdutosFurto();
});

window.abrirModalAuditoria = (itemJson) => {
    const item = JSON.parse(decodeURIComponent(itemJson)); 
    itemEmAuditoria = item;
    let dataFormatada = item.data_validade;
    if (dataFormatada && String(dataFormatada).includes('-')) {
        const p = String(dataFormatada).split('-');
        if (p.length === 3) dataFormatada = `${p[2]}/${p[1]}/${p[0]}`;
    }
    document.getElementById('modal-produto').innerText = item.descricao; 
    document.getElementById('modal-vencimento').innerText = dataFormatada; 
    document.getElementById('modal-qtd-anterior').innerText = item.quantidade; 
    document.getElementById('modal-nova-qtd').value = ''; 
    document.getElementById('modal-auditoria').classList.remove('hidden');
};

const btnCloseModal = document.getElementById('btn-close-modal');
if(btnCloseModal) {
    btnCloseModal.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('modal-auditoria').classList.add('hidden'); });
}

const modalAuditoria = document.getElementById('modal-auditoria');
if(modalAuditoria) {
    modalAuditoria.addEventListener('click', (e) => { if(e.target === modalAuditoria) { modalAuditoria.classList.add('hidden'); } });
}

document.getElementById('form-auditoria')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth.currentUser || !itemEmAuditoria) return;
    const payload = { tipo: "atualizar_validade", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: currentUserFilial, gtin: itemEmAuditoria.gtin, descricao: itemEmAuditoria.descricao, data_validade: itemEmAuditoria.data_validade, quantidade: document.getElementById('modal-nova-qtd').value.replace(',', '.') };
    await submitToSheets(null, 'btn-save-auditoria', 'msg-val-success', 'msg-val-error', payload, '<i data-lucide="check-circle-2" class="w-6 h-6"></i> Atualizar Posição');
    document.getElementById('modal-auditoria').classList.add('hidden');
});

window.marcarRebaixaValidade = async (itemEncoded, checkboxEl) => {
    const item = JSON.parse(decodeURIComponent(itemEncoded));
    const statusRebaixa = checkboxEl.checked ? "SIM" : "NÃO";

    checkboxEl.disabled = true;
    const parentDiv = checkboxEl.closest('.p-3.mb-2');
    if (parentDiv) parentDiv.style.opacity = '0.5';

    const payload = {
        tipo: "atualizar_rebaixa_validade",
        email: auth.currentUser.email,
        empresa: currentUserEmpresa,
        filial: item.filial,
        gtin: item.gtin,
        data_validade: item.data_validade,
        rebaixado: statusRebaixa
    };

    try {
        await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        const idx = sheetsDataRaw.findIndex(i => i.tipo === 'validade' && String(i.gtin) === String(item.gtin) && i.data_validade === item.data_validade && i.filial === item.filial);
        if(idx > -1) sheetsDataRaw[idx].rebaixado = statusRebaixa;
        window.renderValidadeDashboard();
    } catch(e) {
        alert("Erro de comunicação ao marcar rebaixa. Verifique a internet.");
        checkboxEl.checked = !checkboxEl.checked;
    } finally {
        checkboxEl.disabled = false;
        if (parentDiv) parentDiv.style.opacity = '1';
    }
};

window.iniciarAbasConsultor = () => {
    const btnUsers = document.getElementById('btn-admin-tab-users');
    const btnKpi = document.getElementById('btn-admin-tab-kpi');
    const wrapUsers = document.getElementById('admin-wrapper-tab-users');
    const wrapKpi = document.getElementById('admin-wrapper-tab-kpi');

    if(btnUsers && btnKpi && wrapUsers && wrapKpi) {
        btnUsers.addEventListener('click', () => {
            wrapUsers.classList.remove('hidden');
            wrapKpi.classList.add('hidden');
            btnUsers.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
            btnUsers.querySelector('i').classList.add('text-gold');
            btnKpi.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md";
            btnKpi.querySelector('i').classList.remove('text-gold');
        });

        btnKpi.addEventListener('click', () => {
            wrapKpi.classList.remove('hidden');
            wrapUsers.classList.add('hidden');
            btnKpi.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
            btnKpi.querySelector('i').classList.add('text-gold');
            btnUsers.className = "w-[45%] sm:w-[30%] md:w-[20%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md";
            btnUsers.querySelector('i').classList.remove('text-gold');
        });
    }
};
window.iniciarAbasConsultor();

window.loadEmpresasAdmin = async () => {
    const select = document.getElementById('gc-empresa');
    if(!select) return;
    select.innerHTML = '<option value="">A carregar empresas...</option>';
    try {
        const q = query(collection(db, 'empresas'));
        const snap = await getDocs(q);
        let options = '<option value="">Selecione a Empresa Matriz...</option>';
        const empresas = [];
        snap.forEach(doc => empresas.push(doc.data().nome));
        empresas.sort().forEach(e => { options += `<option value="${e}">${e}</option>`; });
        select.innerHTML = options;
    } catch(e) {
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
};

const formNovaEmpresa = document.getElementById('form-nova-empresa');
if(formNovaEmpresa) {
    formNovaEmpresa.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-save-empresa');
        const msg = document.getElementById('msg-ne-success');
        const nome = document.getElementById('ne-nome').value.trim();
        if(!nome) return;
        
        btn.disabled = true; btn.innerHTML = '<i class="w-5 h-5 animate-spin" data-lucide="loader-2"></i> Criando...';
        try {
            await setDoc(doc(db, 'empresas', nome), { nome: nome, createdAt: serverTimestamp() });
            document.getElementById('ne-nome').value = '';
            msg.classList.remove('hidden'); 
            setTimeout(() => msg.classList.add('hidden'), 4000);
            window.loadEmpresasAdmin(); 
        } catch(err) {
            alert('Erro ao cadastrar empresa: ' + err.message);
        } finally {
            btn.disabled = false; btn.innerHTML = `<i class='w-5 h-5' data-lucide='plus'></i> Criar Empresa`;
            if(window.lucide) lucide.createIcons();
        }
    });
}

const formGc = document.getElementById('form-gestao-clientes');
if(formGc) {
    formGc.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btn-save-gc'); const msgError = document.getElementById('msg-gc-error'); const msgSuccess = document.getElementById('msg-gc-success');
        btnSave.disabled = true; btnSave.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> A gravar...'; msgError.classList.add('hidden'); msgSuccess.classList.add('hidden'); if(window.lucide) lucide.createIcons();
        
        try {
            const emailUser = document.getElementById('gc-email').value.trim().toLowerCase();
            const senhaUser = document.getElementById('gc-senha').value;
            const empresa = document.getElementById('gc-empresa').value.trim();
            const filial = document.getElementById('gc-filial').value.trim();
            const role = document.getElementById('gc-role').value;

            if(!empresa) { throw new Error("Selecione uma Empresa Matriz."); }

            const tempApp = initializeApp(firebaseConfig, "temp_" + Date.now());
            const tempAuth = getAuth(tempApp);
            await createUserWithEmailAndPassword(tempAuth, emailUser, senhaUser);
            await signOut(tempAuth); 

            await setDoc(doc(db, 'users_permissions', emailUser), { email: emailUser, company_name: empresa, unit_name: filial, segment: 'varejo', role: role, updatedAt: serverTimestamp() });
            formGc.reset(); msgSuccess.classList.remove('hidden'); setTimeout(() => msgSuccess.classList.add('hidden'), 4000);
        } catch (error) { 
            let erroMsg = error.message;
            if(error.code === 'auth/email-already-in-use') erroMsg = "Este e-mail já existe no sistema.";
            if(error.code === 'auth/weak-password') erroMsg = "A senha deve ter no mínimo 6 caracteres.";
            document.getElementById('txt-gc-error').innerText = "Erro: " + erroMsg; msgError.classList.remove('hidden'); 
        } 
        finally { btnSave.disabled = false; btnSave.innerHTML = '<i data-lucide="save" class="w-5 h-5 text-gold"></i> Vincular Usuário'; if(window.lucide) lucide.createIcons(); }
    });
}

const viewLogin = document.getElementById('auth-view');
const viewAdmin = document.getElementById('view-admin');
const viewClient = document.getElementById('view-client');

window.mudarEstadoSegmento = (estado) => {
    const vc = document.getElementById('view-client');
    if(vc) { vc.classList.remove('estado-hub', 'estado-varejo', 'estado-industria'); vc.classList.add('estado-' + estado); }
    
    const menuVarejo = document.getElementById('menu-abas');
    const menuIndustria = document.getElementById('menu-abas-industria');
    const containerSegmentos = document.getElementById('container-segmentos');

    if (estado === 'hub') {
        if (menuVarejo) menuVarejo.classList.add('hidden');
        if (menuIndustria) menuIndustria.classList.add('hidden');
        if (containerSegmentos) containerSegmentos.classList.remove('hidden');
        unselectAllTabs(); 
    } else if (estado === 'varejo') {
        if (containerSegmentos) containerSegmentos.classList.add('hidden');
        if (menuIndustria) menuIndustria.classList.add('hidden');
        if (menuVarejo) menuVarejo.classList.remove('hidden');
        const btnDash = document.getElementById('btn-tab-dash');
        if(btnDash) btnDash.click(); 
    } else if (estado === 'industria') {
        if (containerSegmentos) containerSegmentos.classList.add('hidden');
        if (menuVarejo) menuVarejo.classList.add('hidden');
        if (menuIndustria) menuIndustria.classList.remove('hidden');
        unselectAllTabs();
        const btnDashInd = document.getElementById('btn-tab-dash-ind');
        if(btnDashInd) {
            btnDashInd.className = "w-[30%] sm:w-[22%] md:w-[18%] lg:w-[12%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
            btnDashInd.querySelector('i').className = 'w-6 h-6 mb-1 text-gold';
        }
    }
};

const showView = (viewName) => {
    if(viewLogin) viewLogin.classList.add('hidden'); 
    if(viewAdmin) viewAdmin.classList.add('hidden'); 
    if(viewClient) viewClient.classList.add('hidden');
    
    if(viewName === 'login' && viewLogin) viewLogin.classList.remove('hidden');
    if(viewName === 'admin' && viewAdmin) viewAdmin.classList.remove('hidden');
    if(viewName === 'client' && viewClient) {
        viewClient.classList.remove('hidden'); 
        if(window.mudarEstadoSegmento) window.mudarEstadoSegmento('hub');
    }
    window.scrollTo(0, 0);
};

const unselectAllTabs = () => {
    ['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) {
            el.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-white text-slate-500 border border-slate-200 hover:border-navy hover:text-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-sm hover:shadow-md"; 
            const ic = el.querySelector('i');
            if(ic) { ic.classList.remove('text-gold'); if(id==='btn-tab-inv')ic.classList.add('text-emerald'); if(id==='btn-tab-tar')ic.classList.add('text-orange-500'); }
        }
    });
    ['wrapper-tab-dash', 'wrapper-tab-form', 'wrapper-tab-recebimento', 'wrapper-tab-validade', 'wrapper-tab-furtos', 'wrapper-tab-preco', 'wrapper-tab-caixa', 'wrapper-tab-inv', 'wrapper-tab-tar'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) el.classList.add('hidden'); 
    });
};

['btn-tab-dash', 'btn-tab-form', 'btn-tab-rec', 'btn-tab-val', 'btn-tab-furtos', 'btn-tab-preco', 'btn-tab-caixa', 'btn-tab-inv', 'btn-tab-tar'].forEach(id => {
    const btn = document.getElementById(id);
    if(btn) {
        btn.addEventListener('click', () => {
            unselectAllTabs(); 
            btn.className = "w-[30%] sm:w-[22%] md:w-[15%] lg:w-[10%] bg-navy text-white border border-navy rounded-xl p-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md";
            const ic = btn.querySelector('i');
            if(ic) { ic.className = 'w-6 h-6 mb-1 text-gold'; }
            
            const map = {'btn-tab-dash':'wrapper-tab-dash', 'btn-tab-form':'wrapper-tab-form', 'btn-tab-rec':'wrapper-tab-recebimento', 'btn-tab-val':'wrapper-tab-validade', 'btn-tab-furtos':'wrapper-tab-furtos', 'btn-tab-preco':'wrapper-tab-preco', 'btn-tab-caixa':'wrapper-tab-caixa', 'btn-tab-inv':'wrapper-tab-inv', 'btn-tab-tar':'wrapper-tab-tar'};
            document.getElementById(map[id]).classList.remove('hidden');
            
            if(id === 'btn-tab-form') { try{ renderQuebrasDashboard(); }catch(e){} }
            if(id === 'btn-tab-rec') { try{ renderDocasDashboard(); }catch(e){} }
            if(id === 'btn-tab-val') { try{ renderValidadeDashboard(); }catch(e){} }
            if(id === 'btn-tab-furtos') { try{ renderFurtosDashboard(); }catch(e){} }
            if(id === 'btn-tab-preco') { try{ renderPrecoDashboard(); }catch(e){} }
            if(id === 'btn-tab-caixa') { try{ renderCaixaDashboard(); }catch(e){} }
            if(id === 'btn-tab-tar') { try{ renderTarefasDashboard(); }catch(e){} }
            if(id === 'btn-tab-inv') { try{ renderInventarioDashboard(); }catch(e){} }
        });
    }
});

const btnCardVarejo = document.getElementById('card-varejo');
if(btnCardVarejo) btnCardVarejo.addEventListener('click', () => window.mudarEstadoSegmento('varejo'));

const loginForm = document.getElementById('login-form');
if(loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        document.getElementById('login-error-box').classList.add('hidden'); 
        document.getElementById('login-loading').classList.remove('hidden');
        try { 
            await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); 
            document.getElementById('login-loading').classList.add('hidden');
        } 
        catch (error) { 
            document.getElementById('login-loading').classList.add('hidden'); 
            document.getElementById('login-error-box').classList.remove('hidden'); 
            document.getElementById('login-error-text').innerText = "Credenciais inválidas."; 
        }
    });
}

document.querySelectorAll('.btn-logout').forEach(btn => btn.addEventListener('click', () => { 
    if(unsubscribeDb) unsubscribeDb(); 
    signOut(auth); 
}));

const btnSwitchClient = document.getElementById('btn-switch-client');
const btnSwitchAdmin = document.getElementById('btn-switch-admin');

if(btnSwitchClient) {
    btnSwitchClient.addEventListener('click', async () => { 
        const clientEmail = document.getElementById('input-client-email')?.value.trim().toLowerCase();
        
        if(!clientEmail) {
            alert("Por favor, digite o e-mail do cliente no campo 'E-mail do Cliente' (Aba Resultados KPI) antes de ver os gráficos."); 
            return;
        }
        
        const originalText = btnSwitchClient.innerHTML;
        btnSwitchClient.innerHTML = '<i class="w-4 h-4 animate-spin" data-lucide="loader-2"></i> Carregando...';
        btnSwitchClient.disabled = true;

        try {
            const docSnap = await getDoc(doc(db, 'users_permissions', clientEmail));
            if (!docSnap.exists()) {
                alert("Cliente não encontrado na base de dados. Verifique o e-mail digitado.");
                return;
            }
            
            const permissoes = docSnap.data();
            currentUserEmpresa = permissoes.company_name;
            currentUserRole = 'admin'; 
            currentUserFilial = permissoes.unit_name || 'Matriz';
            
            const querySnapshot = await getDocs(collection(db, 'users_permissions'));
            const listaFiliais = new Set();
            querySnapshot.forEach((d) => {
                const dados = d.data();
                if(dados.company_name === currentUserEmpresa && dados.unit_name) {
                    listaFiliais.add(dados.unit_name);
                }
            });
            
            const selectsLançamento =['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial'];
            const selectsDashboard =['filtro-filial-quebra', 'filtro-filial-docas', 'filtro-filial-validade', 'filtro-filial-furtos', 'filtro-filial-preco', 'filtro-filial-caixa', 'filtro-filial-inv', 'filtro-filial-tar'];
            
            selectsLançamento.forEach(id => {
                const el = document.getElementById(id);
                if(el) {
                    el.innerHTML = ''; 
                    Array.from(listaFiliais).sort().forEach(f => {
                        el.innerHTML += `<option value="${f}">${f}</option>`;
                    });
                    el.value = currentUserFilial; 
                    el.disabled = false; 
                }
            });

            selectsDashboard.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.innerHTML = '<option value="todas">Todas as Lojas</option>';
                    Array.from(listaFiliais).sort().forEach(f => {
                        el.innerHTML += `<option value="${f}">${f}</option>`;
                    });
                    el.classList.remove('hidden');
                }
            });
            
            const sepAdmin = document.getElementById('separator-admin');
            if(sepAdmin) sepAdmin.innerText = `${currentUserEmpresa} | Visão Consultor`;
            
            showView('client'); 
            fetchSheetsDataComHierarquia();
            
        } catch (error) {
            console.error(error);
            alert("Erro ao processar as permissões do cliente.");
        } finally {
            btnSwitchClient.innerHTML = originalText;
            btnSwitchClient.disabled = false;
            if(window.lucide) lucide.createIcons();
        }
    });
}

if(btnSwitchAdmin) btnSwitchAdmin.addEventListener('click', () => showView('admin'));

onAuthStateChanged(auth, async (user) => {
    const loadBox = document.getElementById('login-loading');
    if(loadBox) loadBox.classList.add('hidden');

    if (user) {
        const topEmail = document.getElementById('top-user-email');
        if (topEmail) topEmail.innerText = user.email;

        const btnAdmin = document.getElementById('btn-switch-admin'); 
        const sepAdmin = document.getElementById('separator-admin');
        const adminEmailDisplay = document.getElementById('admin-user-email');
        if (user.email === ADMIN_EMAIL || user.email.includes('leandro')) {
            if(btnAdmin) btnAdmin.style.display = 'flex'; 
            if(sepAdmin) sepAdmin.innerText = 'Área do Consultor';
            if(adminEmailDisplay) adminEmailDisplay.innerText = user.email;
            showView('admin');
            
            setTimeout(() => {
                window.loadEmpresasAdmin();
                const btnAdminUsers = document.getElementById('btn-admin-tab-users');
                if(btnAdminUsers) btnAdminUsers.click();
            }, 500);
            
        } else {
            if(btnAdmin) btnAdmin.style.display = 'none';
            try {
                const docSnap = await getDoc(doc(db, 'users_permissions', user.email));
                if (docSnap.exists()) {
                    const permissoes = docSnap.data();
                    currentUserEmpresa = permissoes.company_name;
                    currentUserFilial = permissoes.unit_name;
                    currentUserRole = permissoes.role || 'operacional';
                    
                    const selectsLançamento = ['q-filial-lancamento', 'r-filial-lancamento', 'v-filial-lancamento', 'f-filial', 'p-filial-lancamento', 'c-filial-lancamento', 'inv-nova-filial', 't-filial'];
                    const selectsDashboard = ['filtro-filial-quebra', 'filtro-filial-docas', 'filtro-filial-validade', 'filtro-filial-furtos', 'filtro-filial-preco', 'filtro-filial-caixa', 'filtro-filial-inv', 'filtro-filial-tar'];
                    
                    if (currentUserRole === 'admin') {
                        const querySnapshot = await getDocs(collection(db, 'users_permissions'));
                        const listaFiliais = new Set();
                        querySnapshot.forEach((d) => {
                            const dados = d.data();
                            if(dados.company_name === currentUserEmpresa && dados.unit_name) {
                                listaFiliais.add(dados.unit_name);
                            }
                        });
                        
                        selectsLançamento.forEach(id => {
                            const el = document.getElementById(id);
                            if(el) {
                                el.innerHTML = ''; 
                                Array.from(listaFiliais).sort().forEach(f => {
                                    el.innerHTML += `<option value="${f}">${f}</option>`;
                                });
                                el.value = currentUserFilial; 
                                el.disabled = false; 
                            }
                        });

                        selectsDashboard.forEach(id => {
                            const el = document.getElementById(id);
                            if (el) {
                                el.innerHTML = '<option value="todas">Todas as Lojas</option>';
                                Array.from(listaFiliais).sort().forEach(f => {
                                    el.innerHTML += `<option value="${f}">${f}</option>`;
                                });
                                el.classList.remove('hidden');
                            }
                        });

                    } else {
                        selectsLançamento.forEach(id => {
                            const el = document.getElementById(id);
                            if(el) {
                                el.innerHTML = `<option value="${currentUserFilial}">${currentUserFilial}</option>`;
                                el.value = currentUserFilial;
                                el.disabled = true; 
                            }
                        });

                        selectsDashboard.forEach(id => {
                            const el = document.getElementById(id);
                            if (el) el.classList.add('hidden'); 
                        });
                    }
                    
                    if(sepAdmin) sepAdmin.innerText = permissoes.company_name + (currentUserRole === 'admin' ? ' | Visão Geral' : ' | ' + permissoes.unit_name);
                    
                    showView('client'); 
                    if (typeof fetchSheetsDataComHierarquia === 'function') fetchSheetsDataComHierarquia(); 
                } else { 
                    alert("Acesso Negado: O usuário ainda não tem filiais cadastradas."); 
                    signOut(auth); 
                }
            } catch(e) {
                console.error(e);
                alert("Erro ao validar hierarquia. Tente novamente.");
                signOut(auth);
            }
        }
    } else { 
        showView('login'); 
        const topEmail = document.getElementById('top-user-email');
        if (topEmail) topEmail.innerText = '';
    }
});

document.getElementById('btn-export-csv-inv')?.addEventListener('click', (e) => { e.preventDefault(); exportDataToCSV('inventario', 'Inventario_Lotes'); });

window.iniciarNovoInventario = (event) => {
    const filial = document.getElementById('inv-nova-filial').value;
    if(!filial) { alert('Selecione a filial para iniciar.'); return; }
    
    const isDirigido = document.getElementById('inv-is-dirigido').checked;
    const textoGtins = document.getElementById('inv-lista-gtins').value;
    let listaLimpa = [];
    
    if (isDirigido) {
        if (!textoGtins.trim()) { alert('Cole os GTINs para o inventário dirigido.'); return; }
        listaLimpa = textoGtins.split(/[\n,;]+/).map(g => g.replace(/[^0-9]/g, '')).filter(g => g.length > 5);
        if (listaLimpa.length === 0) { alert('Nenhum GTIN válido encontrado.'); return; }
    }

    const novoId = 'INV-' + Math.floor(100000 + Math.random() * 900000);
    
    if (isDirigido) {
        const payload = { 
            tipo: "inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, 
            lote: "SISTEMA", gtin: "LISTA_DIRIGIDA", descricao: JSON.stringify(listaLimpa), quantidade: 0, id_inventario: novoId, status: "ABERTO"
        };
        sheetsDataRaw.push(payload); 
        fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    }
    
    document.getElementById('inv-lista-gtins').value = '';
    document.getElementById('inv-is-dirigido').checked = false;
    document.getElementById('inv-box-dirigido').classList.add('hidden');
    
    window.abrirTelaBipagem(novoId, filial);
};

window.consultarInventario = () => {
    let busca = document.getElementById('inv-id-busca').value.trim().toUpperCase();
    if(!busca) return;
    if(!busca.startsWith('INV-')) busca = 'INV-' + busca;

    const inventarios = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === busca);
    if(inventarios.length === 0) { alert('Inventário não encontrado na base de dados.'); return; }
    const fechado = inventarios.some(i => i.status === 'FECHADO');
    if(fechado) { alert('Este inventário já foi encerrado pelo Gerente e está travado para novas contagens.'); return; }

    window.abrirTelaBipagem(busca, inventarios[0].filial);
};

window.abrirTelaBipagem = (idInv, filial) => {
    document.getElementById('inv-tela-selecao').classList.add('hidden');
    document.getElementById('inv-tela-bipagem').classList.remove('hidden');
    document.getElementById('ui-inv-id').innerText = idInv;
    document.getElementById('ui-inv-filial').innerText = filial;
    document.getElementById('inv-id-oculto').value = idInv;
    document.getElementById('inv-filial-oculto').value = filial;
    setTimeout(() => document.getElementById('inv-lote').focus(), 100);
    window.renderHistoricoBipagem(idInv);
};

window.voltarTelaInventario = () => {
    document.getElementById('inv-tela-bipagem').classList.add('hidden');
    document.getElementById('inv-tela-selecao').classList.remove('hidden');
    window.renderInventarioDashboard(); 
};

window.encerrarInventarioAtual = async (event) => {
    const idInv = document.getElementById('inv-id-oculto').value;
    const filial = document.getElementById('inv-filial-oculto').value;
    if(!confirm(`⚠️ ATENÇÃO: Deseja encerrar o inventário ${idInv}? Produtos dirigidos não bipados serão negativados (Zerados) automaticamente no sistema.`)) return;
    
    const btn = event.currentTarget; const txtOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="w-4 h-4 animate-spin" data-lucide="loader-2"></i> Encerrando...';
    
    const items = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv);
    const linhaMestre = items.find(i => i.gtin === 'LISTA_DIRIGIDA');
    let naoEncontrados = [];
    
    if (linhaMestre) {
        let gtinsEsperados = [];
        try { gtinsEsperados = JSON.parse(linhaMestre.descricao); } catch(e){}
        const mapaBipados = {};
        items.filter(i => i.gtin !== 'LISTA_DIRIGIDA' && i.gtin !== 'FECHAMENTO').forEach(b => {
            if(!mapaBipados[b.gtin]) mapaBipados[b.gtin] = 0;
            mapaBipados[b.gtin] += parseFloat(b.quantidade);
        });
        
        gtinsEsperados.forEach(gtin => {
            if(!mapaBipados[gtin] || mapaBipados[gtin] <= 0) naoEncontrados.push(gtin);
        });
    }

    const payload = { tipo: "fechar_inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, id_inventario: idInv, nao_encontrados: naoEncontrados };
    
    try {
        await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        alert('Inventário encerrado! Os itens não encontrados foram zerados com sucesso.');
        sheetsDataRaw.push({ tipo: 'inventario', id_inventario: idInv, status: 'FECHADO', gtin: 'FECHAMENTO' });
        window.voltarTelaInventario();
    } catch(e) { alert('Erro ao encerrar inventário.'); } finally { btn.innerHTML = txtOriginal; lucide.createIcons(); }
};

const toggleQtd = document.getElementById('inv-travar-qtd');
const inputQtd = document.getElementById('inv-qtd');
const inputGtin = document.getElementById('inv-gtin');

if(toggleQtd) {
    toggleQtd.addEventListener('change', (e) => {
        if(e.target.checked) { inputQtd.value = 1; inputQtd.readOnly = true; inputQtd.classList.add('bg-slate-200', 'text-slate-500'); } 
        else { inputQtd.value = ''; inputQtd.readOnly = false; inputQtd.classList.remove('bg-slate-200', 'text-slate-500'); }
        inputGtin.focus();
    });
}

document.getElementById('form-inventario')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const idInv = document.getElementById('inv-id-oculto').value;
    const filial = document.getElementById('inv-filial-oculto').value;
    const lote = document.getElementById('inv-lote').value.trim().toUpperCase();
    
    const payload = { 
        tipo: "inventario", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, 
        lote: lote, gtin: inputGtin.value, descricao: document.getElementById('inv-desc').value, 
        quantidade: inputQtd.value, id_inventario: idInv, status: "ABERTO"
    };
    
    await submitToSheets(null, 'btn-save-inv', 'msg-inv-success', 'msg-inv-error', payload, '<i data-lucide="plus-square" class="w-5 h-5 text-gold"></i> Salvar Bipagem');
    
    sheetsDataRaw.push({ tipo: "inventario", lote: lote, gtin: inputGtin.value, descricao: document.getElementById('inv-desc').value, quantidade: inputQtd.value, id_inventario: idInv, status: "ABERTO", filial: filial });
    
    inputGtin.value = ''; document.getElementById('inv-desc').value = '';
    if(!toggleQtd.checked) inputQtd.value = '';
    setTimeout(() => inputGtin.focus(), 100); 
    window.renderHistoricoBipagem(idInv);
});

window.renderHistoricoBipagem = (idInv) => {
    const divHist = document.getElementById('inv-historico-bipagem');
    const boxProgresso = document.getElementById('box-progresso-dirigido');
    const divListaDir = document.getElementById('inv-lista-dirigida');
    if(!divHist) return;
    
    const items = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv && i.gtin !== 'FECHAMENTO');
    const linhaMestre = items.find(i => i.gtin === 'LISTA_DIRIGIDA');
    const bipagens = items.filter(i => i.gtin !== 'LISTA_DIRIGIDA').reverse();

    if(bipagens.length === 0) { 
        divHist.innerHTML = '<p class="text-xs text-slate-400 italic">Nenhum item bipado ainda.</p>'; 
    } else {
        let html = '';
        bipagens.slice(0, 15).forEach(i => {
            html += `<div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded mb-1"><div class="flex flex-col"><span class="text-xs font-bold text-navy">${i.descricao || i.gtin}</span><span class="text-[10px] text-slate-400">Lote: ${i.lote} | EAN: ${i.gtin}</span></div><span class="text-sm font-black text-emerald bg-emerald/10 px-2 py-1 rounded border border-emerald/20">${i.quantidade} un</span></div>`;
        });
        divHist.innerHTML = html;
    }

    if(linhaMestre && boxProgresso && divListaDir) {
        boxProgresso.classList.remove('hidden');
        let gtinsEsperados = [];
        try { gtinsEsperados = JSON.parse(linhaMestre.descricao); } catch(e){}
        
        let htmlDirigida = ''; let encontrados = 0;
        const mapaBipados = {};
        bipagens.forEach(b => { if(!mapaBipados[b.gtin]) mapaBipados[b.gtin] = 0; mapaBipados[b.gtin] += parseFloat(b.quantidade); });

        gtinsEsperados.forEach(gtinE => {
            const foiBipado = mapaBipados[gtinE] && mapaBipados[gtinE] > 0;
            if(foiBipado) encontrados++;
            const prodMestre = produtosMestre.find(p => p.gtin === gtinE);
            const nomeExibicao = prodMestre ? prodMestre.descricao : gtinE;
            
            const corBg = foiBipado ? 'bg-emerald/10 border-emerald/20' : 'bg-white border-slate-200';
            const icone = foiBipado ? `<i class="w-4 h-4 text-emerald" data-lucide="check-circle-2"></i>` : `<i class="w-4 h-4 text-slate-300" data-lucide="circle"></i>`;
            const qdtStr = foiBipado ? `<span class="text-xs font-bold text-emerald">${mapaBipados[gtinE]} un</span>` : `<span class="text-[10px] text-red-400 font-bold uppercase">Pendente</span>`;

            htmlDirigida += `<div class="flex justify-between items-center p-2 border rounded ${corBg} transition-colors"><div class="flex items-center gap-2">${icone}<span class="text-xs font-bold text-slate-700 truncate w-32" title="${nomeExibicao}">${nomeExibicao}</span></div>${qdtStr}</div>`;
        });

        divListaDir.innerHTML = htmlDirigida;
        const perc = gtinsEsperados.length > 0 ? Math.round((encontrados / gtinsEsperados.length) * 100) : 0;
        document.getElementById('ui-inv-progresso-text').innerText = `${encontrados} / ${gtinsEsperados.length} Encontrados`;
        document.getElementById('ui-inv-progresso-bar').style.width = `${perc}%`;
    } else if (boxProgresso) { boxProgresso.classList.add('hidden'); }
    
    if(window.lucide) lucide.createIcons();
};

window.renderListaInventarios = () => {
    const tbody = document.getElementById('inv-tbody-consulta');
    if(!tbody) return;
    const filtroFilial = document.getElementById('filtro-filial-inv')?.value;

    let inventarios = sheetsDataRaw.filter(i => i.tipo === 'inventario' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    
    if (filtroFilial && filtroFilial !== 'todas') {
        inventarios = inventarios.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    }

    const mapInv = {};
    inventarios.forEach(i => {
        if(!i.id_inventario) return;
        if(!mapInv[i.id_inventario]) {
            mapInv[i.id_inventario] = { id: i.id_inventario, filial: i.filial, qtdLeituras: 0, fechado: false };
        }
        if(i.status === 'FECHADO' || i.gtin === 'FECHAMENTO') {
            mapInv[i.id_inventario].fechado = true;
        } else if (i.gtin !== 'LISTA_DIRIGIDA') {
            mapInv[i.id_inventario].qtdLeituras++;
        }
    });

    const listaArr = Object.values(mapInv).sort((a,b) => {
        if (a.fechado !== b.fechado) return a.fechado ? 1 : -1; 
        return b.id.localeCompare(a.id);
    });

    if(listaArr.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400 italic">Nenhum inventário localizado para esta filial.</td></tr>'; 
        return; 
    }

    let html = '';
    listaArr.forEach(inv => {
        const statusBadge = inv.fechado 
            ? `<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-slate-200"><i class="w-3 h-3 inline pb-0.5" data-lucide="lock"></i> Fechado</span>`
            : `<span class="bg-emerald/10 text-emerald px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border border-emerald/20"><i class="w-3 h-3 inline pb-0.5" data-lucide="unlock"></i> Aberto</span>`;
            
        const btnContinuar = !inv.fechado 
            ? `<button type="button" onclick="abrirTelaBipagem('${inv.id}', '${inv.filial}')" class="text-xs bg-navy text-white hover:bg-navyLight px-3 py-1.5 rounded transition-colors shadow-sm inline-flex items-center gap-1" title="Continuar Bipagem"><i class="w-3 h-3" data-lucide="scan-barcode"></i> Contar</button>` 
            : '';
            
        const btnExportar = `<button type="button" onclick="exportarInventarioId('${inv.id}')" class="text-xs bg-white text-emerald border border-slate-200 hover:border-emerald hover:bg-emerald/5 px-3 py-1.5 rounded transition-colors shadow-sm inline-flex items-center gap-1" title="Gerar Excel de Contagens"><i class="w-3 h-3" data-lucide="file-spreadsheet"></i> Relatório</button>`;

        html += `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-navy">${inv.id}</td>
            <td class="px-6 py-4 text-slate-600 text-xs">${inv.filial}</td>
            <td class="px-6 py-4">${statusBadge}</td>
            <td class="px-6 py-4 text-center font-medium text-slate-700">${inv.qtdLeituras}</td>
            <td class="px-6 py-4 text-right space-x-2">
                ${btnContinuar}
                ${btnExportar}
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;
    if(window.lucide) lucide.createIcons();
};

window.exportarInventarioId = (idInv) => {
    const dataToExport = sheetsDataRaw.filter(i => i.tipo === 'inventario' && i.id_inventario === idInv);
    if(dataToExport.length === 0) { alert("Nenhum dado encontrado para este inventário."); return; }
    
    const rows = [];
    rows.push(["Data do Registo", "Lote/Corredor", "GTIN", "Descrição", "Quantidade", "Status da Leitura"].join(";"));
    
    dataToExport.forEach(item => {
        if (item.gtin === 'LISTA_DIRIGIDA' || item.gtin === 'FECHAMENTO') return; 
        
        let statusLeitura = "Contado Fisicamente";
        if (item.descricao === 'ZERAMENTO AUTOMÁTICO') {
            statusLeitura = "Não Encontrado (Zerado)";
        }

        const linha = [
            `"${item.data_registro || ''}"`,
            `"${item.lote || 'Sem Lote'}"`,
            `"${item.gtin || ''}"`,
            `"${item.descricao || 'Produto sem nome'}"`,
            `${item.quantidade || 0}`,
            `"${statusLeitura}"`
        ];
        rows.push(linha.join(";"));
    });

    const csvContent = "\uFEFF" + rows.join("\n"); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Inventario_${idInv}_Relatorio.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
window.renderInventarioDashboard = window.renderListaInventarios;

document.getElementById('form-tarefas')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!auth.currentUser) return;
    const payload = { 
        tipo: "tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: document.getElementById('t-filial').value, 
        titulo: document.getElementById('t-titulo').value, prazo: document.getElementById('t-prazo').value, status: 'PENDENTE'
    };
    await submitToSheets(e.target, 'btn-save-tar', 'msg-tar-success', '', payload, 'Criar Demanda');
    fetchSheetsDataComHierarquia(); 
});

window.concluirTarefa = async (tituloEncoded, filial, checkboxEl) => {
    checkboxEl.disabled = true;
    const titulo = decodeURIComponent(tituloEncoded);
    
    const parentDiv = checkboxEl.closest('.flex.items-center.justify-between');
    if(parentDiv) parentDiv.style.opacity = '0.4';

    const payload = { tipo: "concluir_tarefa", email: auth.currentUser.email, empresa: currentUserEmpresa, filial: filial, titulo: titulo };
    
    try {
        await fetch(GOOGLE_SHEETS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        
        const tIndex = sheetsDataRaw.findIndex(i => i.tipo === 'tarefa' && i.titulo === titulo && i.filial === filial && i.status === 'PENDENTE');
        if(tIndex > -1) sheetsDataRaw[tIndex].status = 'CONCLUÍDA';
        
        window.renderTarefasDashboard(); 
    } catch(e) {
        alert("Erro ao concluir tarefa. Verifique sua conexão com a internet.");
        checkboxEl.disabled = false;
        checkboxEl.checked = false;
        if(parentDiv) parentDiv.style.opacity = '1';
    }
};

window.renderTarefasDashboard = () => {
    const divSis = document.getElementById('lista-tarefas-sistema');
    const divMan = document.getElementById('lista-tarefas-manuais');
    if(!divSis || !divMan) return;

    const filtroFilial = document.getElementById('filtro-filial-tar')?.value;

    let htmlSis = ''; let htmlMan = '';
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    let validades = sheetsDataRaw.filter(i => i.tipo === 'validade' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') {
        validades = validades.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    }

    validades.forEach(v => {
        let pData = String(v.data_validade).split('/');
        let dVenc = pData.length === 3 ? new Date(pData[2], pData[1] - 1, pData[0]) : new Date(v.data_validade + 'T00:00:00');
        let dias = Math.ceil((dVenc.getTime() - hoje.getTime()) / (1000 * 3600 * 24));

        if(dias <= 15 && dias >= 0) {
            const itemEncoded = encodeURIComponent(JSON.stringify(v));
            htmlSis += `<div class="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between"><div class="flex items-center gap-3"><i class="w-5 h-5 text-red-600" data-lucide="alert-triangle"></i><div><p class="text-sm font-bold text-red-800">Risco de Vencimento: ${v.descricao || 'Produto'}</p><p class="text-xs text-red-600 font-medium">Vence em ${dias} dias | Loja: ${v.filial}</p></div></div><button onclick="window.abrirModalAuditoria('${itemEncoded}')" type="button" class="bg-red-600 text-white text-xs px-3 py-1.5 rounded hover:bg-red-700 font-bold shadow-sm">Auditar</button></div>`;
        }
    });

    let tarefas = sheetsDataRaw.filter(i => i.tipo === 'tarefa' && i.status === 'PENDENTE' && (currentUserRole === 'admin' || i.filial === currentUserFilial));
    if (filtroFilial && filtroFilial !== 'todas') {
        tarefas = tarefas.filter(i => String(i.filial).trim() === String(filtroFilial).trim());
    }

    tarefas.forEach(t => {
        const tituloEncoded = encodeURIComponent(t.titulo);
        htmlMan += `<div class="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between transition-opacity duration-300"><div class="flex items-center gap-3"><input type="checkbox" onchange="window.concluirTarefa('${tituloEncoded}', '${t.filial}', this)" class="w-5 h-5 rounded border-slate-300 text-navy focus:ring-navy cursor-pointer"><div><p class="text-sm font-bold text-navy">${t.titulo}</p><p class="text-xs text-slate-500 font-medium">Prazo: ${t.prazo} | Loja: ${t.filial}</p></div></div></div>`;
    });

    divSis.innerHTML = htmlSis || '<p class="text-sm text-slate-400 text-center py-4">Nenhum risco sistêmico detectado para esta loja.</p>';
    divMan.innerHTML = htmlMan || '<p class="text-sm text-slate-400 text-center py-4">Nenhuma demanda pendente para esta loja.</p>';
    if(window.lucide) lucide.createIcons();
};

const autocompletarPorGtin = (gtin, inputsAlvo) => {
    const busca = String(gtin).replace(/[^0-9]/g, '');
    if(busca.length === 0) return; 
    
    const produto = produtosMestre.find(p => p.gtin === busca);
    if(produto) {
        if(inputsAlvo.desc && document.getElementById(inputsAlvo.desc)) document.getElementById(inputsAlvo.desc).value = produto.descricao || '';
        if(inputsAlvo.custo && document.getElementById(inputsAlvo.custo)) document.getElementById(inputsAlvo.custo).value = produto.custo || '';
        if(inputsAlvo.preco && document.getElementById(inputsAlvo.preco)) document.getElementById(inputsAlvo.preco).value = produto.preco || '';
        
        const inputOrigem = document.activeElement;
        if(inputOrigem) {
            inputOrigem.classList.add('border-emerald', 'bg-emerald/5');
            setTimeout(() => inputOrigem.classList.remove('border-emerald', 'bg-emerald/5'), 500);
        }
    }
};

const mapeamentoGtin = [
    { gtinId: 'inv-gtin', alvos: { desc: 'inv-desc' } },
    { gtinId: 'q-gtin', alvos: { desc: 'q-desc', custo: 'q-custo' } },
    { gtinId: 'p-gtin', alvos: { desc: 'p-desc', preco: 'p-sistema' } },
    { gtinId: 'v-gtin', alvos: { desc: 'v-desc', custo: 'v-custo' } }
];

mapeamentoGtin.forEach(mapa => {
    const inputEan = document.getElementById(mapa.gtinId);
    if(inputEan) {
        inputEan.addEventListener('change', (e) => autocompletarPorGtin(e.target.value, mapa.alvos));
        inputEan.addEventListener('blur', (e) => autocompletarPorGtin(e.target.value, mapa.alvos));
    }
});
