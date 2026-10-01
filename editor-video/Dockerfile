# CorteFácil para servidores com Docker (EasyPanel, Coolify, Portainer...).
# Variáveis: CF_SENHA (obrigatória: senha de acesso). Volume: /dados (projetos e modelos de voz).
FROM python:3.12-slim

# ffmpeg com libass (legendas) e fontes compatíveis com Arial/Verdana.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV EDITOR_DADOS=/dados \
    HF_HOME=/dados/modelos \
    CF_ESCUTAR=0.0.0.0 \
    CF_CONTAINER=1 \
    PORTA=8765 \
    PYTHONUNBUFFERED=1
VOLUME /dados
EXPOSE 8765
CMD ["python", "iniciar.py", "--sem-navegador"]
