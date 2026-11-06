FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN cd remotion && npm install && npx remotion browser ensure
CMD ["python3", "scripts/runway_video.py", "--workspace", "/app", "doctor"]
