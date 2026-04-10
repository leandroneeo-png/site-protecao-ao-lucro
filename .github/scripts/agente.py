import os
import requests
import re

api_key = os.environ.get("GEMINI_API_KEY")
issue_text = os.environ.get("ISSUE_BODY")

# Lê o código atual
with open("js/app.js", "r", encoding="utf-8") as f:
    app_js = f.read()

with open("index.html", "r", encoding="utf-8") as f:
    index_html = f.read()

prompt = f"""Você é o Agente Especialista LUCROSEGURO (Staff Engineer).
O usuário pediu a seguinte alteração no sistema:
{issue_text}

Aqui está o código atual do app.js:
<CODIGO_APP>
{app_js}
</CODIGO_APP>

Aqui está o código atual do index.html:
<CODIGO_INDEX>
{index_html}
</CODIGO_INDEX>

SUA MISSÃO:
1. Analisar o pedido.
2. Modificar os códigos necessários (sempre retorne os códigos 100% completos, sem resumos ou omitir linhas).
3. Explicar detalhadamente o que foi feito.

Você DEVE responder EXATAMENTE no formato abaixo. NÃO use blocos markdown (```) dentro das tags finais, apenas o código puro:

<RELATORIO>
(Escreva aqui em português o que você fez, por que fez, e como a lógica funciona)
</RELATORIO>

<APP_JS>
(Cole aqui o código completo do app.js atualizado)
</APP_JS>

<INDEX_HTML>
(Cole aqui o código completo do index.html atualizado)
</INDEX_HTML>
"""

url = f"[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=){api_key}"
payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {"temperature": 0.1} # Alta precisão lógica
}

response = requests.post(url, json=payload)
data = response.json()
resposta_ia = data['candidates'][0]['content']['parts'][0]['text']

# Extrai os dados gerados
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
        f.write("Erro: A Inteligência Artificial não conseguiu processar o arquivo completo. Tente dividir o seu pedido na Issue em etapas menores.")
