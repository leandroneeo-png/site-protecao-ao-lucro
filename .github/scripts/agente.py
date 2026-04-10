import os
import requests
import re
import json

api_key = os.environ.get("GEMINI_API_KEY")
issue_text = os.environ.get("ISSUE_BODY")

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

# Endpoint apontado para o modelo 2.0-flash (Cota Gratuita Massiva Liberada para Scripts)
endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {"temperature": 0.1}
}

try:
    response = requests.post(endpoint, params={"key": api_key}, json=payload)
    data = response.json()

    if response.status_code != 200:
        erro_msg = f"⚠️ Erro na API da Google (Código {response.status_code}):\n```json\n{json.dumps(data, indent=2)}\n```\nVerifique a sua GEMINI_API_KEY."
        with open("relatorio.txt", "w", encoding="utf-8") as f:
            f.write(erro_msg)
    elif 'candidates' not in data:
        erro_msg = f"⚠️ A API bloqueou a resposta:\n```json\n{json.dumps(data, indent=2)}\n```"
        with open("relatorio.txt", "w", encoding="utf-8") as f:
            f.write(erro_msg)
    else:
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
                f.write("Erro: A IA não formatou o código corretamente. Tente pedir novamente na Issue.")
except Exception as e:
    with open("relatorio.txt", "w", encoding="utf-8") as f:
        f.write(f"Erro interno no script do GitHub: {str(e)}")
