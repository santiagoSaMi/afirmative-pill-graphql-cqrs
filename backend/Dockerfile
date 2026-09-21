FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencias (capa cacheable). Sin lockfile -> npm install.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY schema.graphql ./schema.graphql
COPY db ./db
COPY src ./src

# Ejecutar como usuario sin privilegios
USER node
EXPOSE 4000

CMD ["node", "--import", "tsx", "src/index.ts"]
