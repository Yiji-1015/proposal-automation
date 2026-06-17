# 현재 사용 안 함

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g kordoc

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --break-system-packages \
    --no-cache-dir \
    -r requirements.txt

COPY server.py .

EXPOSE 8888

CMD ["python3", "server.py"]