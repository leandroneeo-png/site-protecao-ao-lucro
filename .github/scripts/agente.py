import os
import requests
import re

api_key = os.environ.get("GEMINI_API_KEY")
issue_text = os.environ.get("ISSUE_BODY")

# Lendo arquivos atuais
with open("js/app.js", "r", encoding="utf-8") as f:
    app_js = f.read()

with open("index.html", "r", encoding="utf-8") as f:
    index_html = f.read()

prompt = f"""Você é o Agente Especialista LUCROSEGURO (Staff Engineer).
O usuário pediu a seguinte alteração:
{issue_text}

Aqui está o app.js atual:
<APP_ATUAL>
{app_js}
</APP_ATUAL>

Aqui está o index.html atual:
<INDEX_ATUAL>
{index_html}
</INDEX_ATUAL>

Retorne exatamente neste formato:
<RELATORIO>
O que foi feito e como a lógica funciona.
</RELATORIO>
<APP_JS>
(Código app.js completo e atualizado)
</APP_JS>
<INDEX_HTML>
(Código index.html completo e atualizado)
</INDEX_HTML>
"""

# Endpoint limpo e sem parâmetros na string para impedir que o GitHub o transforme num hiperlink
endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent"

payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {"temperature": 0.1}
}

# Passamos a chave da API separadamente através do dicionário 'params'
response = requests.post(endpoint, params={"key": api_key}, json=payload)
data = response.json()

try:
    resposta_ia = data['candidates'][0]['content']['parts'][0]['text']

    relatorio = re.search(r'<RELATORIO>(.*?)</RELATORIO>', resposta_ia, re.DOTALL)
    novo_app = re.search(r'<APP_JS>(.*?)</APP_JS>', resposta_ia, re.DOTALL)
    novo_index = re.search(r'<INDEX_HTML>(.*?)</INDEX_HTML>', resposta_ia, re.DOTALL)

    if relatorio and novo_app and novo_index:
        with open("js/app.js", "w", encoding="utf-8") as f:
            f.write(novo_app.group(1).strip())
        with open("index.html", "w", encoding="utf-8") as f:
            f.write(novo_index.group(1).strip())
        with open("relatorio.txt", "w", encoding="utf-8") as f:
            f.write(relatorio.group(1).strip())
    else:
        with open("relatorio.txt", "w", encoding="utf-8") as f:
            f.write("Erro: O Agente não conseguiu gerar os códigos completos no formato correto.")
except Exception as e:
    with open("relatorio.txt", "w", encoding="utf-8") as f:
        f.write(f"Erro de processamento da API: {str(e)}")
