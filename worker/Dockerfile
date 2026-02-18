# ==============================================================================
# Ignite Worker Dockerfile
# Base: Node 20 (Debian Bookworm) + Python 3 + PrinceXML
# ==============================================================================

FROM node:20-bookworm

# 1. Install System Dependencies & Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    libgomp1 \
    libxml2 \
    libpixman-1-0 \
    libgif7 \
    libjpeg62-turbo \
    libpng16-16 \
    libtiff6 \
    libwebp7 \
    libfreetype6 \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

# 2. Install PrinceXML 15 (Debian 12 / Bookworm compatible)
RUN curl -o prince.deb https://www.princexml.com/download/prince_15.3-1_debian12_amd64.deb \
    && apt-get install -y ./prince.deb \
    && rm prince.deb

# 3. Setup Python Virtual Environment for Validation Scripts
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python deps (pdfplumber, numpy used in verify-page-fill.py etc)
# Note: Adjust versions based on repo requirements
RUN pip install pdfplumber numpy pandas scikit-learn

# 4. Setup Worker Directory
WORKDIR /app

# 5. Copy Package Files
COPY package.json package-lock.json ./
RUN npm ci

# 6. Copy Pipeline Code
# We copy the specific folders needed for the execution plane
COPY new_pipeline ./new_pipeline
COPY scripts ./scripts
COPY tsconfig.json ./

# 7. Copy Fonts (Optional - if stored in repo)
# COPY fonts /usr/share/fonts/truetype/custom
# RUN fc-cache -f -v

# 8. Copy Worker Source
# This assumes the worker logic (polling/uploading) is in /worker/src
COPY worker ./worker

# 9. Build Worker (if TypeScript)
# RUN npx tsc -p worker/tsconfig.json

# 10. Runtime Environment
ENV NODE_ENV=production
# Force Prince to use installed fonts
ENV PRINCE_FONT_CONFIG=/etc/fonts/fonts.conf 

# Entrypoint: The worker runner
CMD ["npx", "tsx", "worker/src/index.ts"]











