FROM node:20-slim AS base

# Install Python 3 + pip + system deps for pymupdf / validation scripts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      curl ca-certificates libfontconfig1 && \
    rm -rf /var/lib/apt/lists/*

# Install Python packages for validation scripts
RUN pip3 install --no-cache-dir --break-system-packages pymupdf

# Install Prince XML 15 (amd64 .deb)
RUN curl -sS -o /tmp/prince.deb \
      https://www.princexml.com/download/prince_15.4.1-1_amd64.deb && \
    apt-get update && \
    apt-get install -y --no-install-recommends /tmp/prince.deb && \
    rm /tmp/prince.deb && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

CMD ["node", "dist/src/runner.js"]

