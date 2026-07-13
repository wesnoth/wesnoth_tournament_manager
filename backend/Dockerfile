FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci \
    && apk del .build-deps

# Copiar código fuente
COPY src ./src
COPY tsconfig.json ./
COPY migrations ./migrations

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["npm", "start"]
